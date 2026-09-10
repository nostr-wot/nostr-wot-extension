import { AsyncLock } from '@utils/asyncLock.ts';
import { iterationsFor, deriveKey, encrypt, decrypt } from './encryption.ts';
import { toMemoryAccount, toStoragePayload } from './serialization.ts';
import { createAccountAccess } from './accountAccess.ts';
import { createImportedKeyAccess } from './importedKeys.ts';
import {
  VAULT_STORAGE_KEY as STORAGE_KEY,
  VAULT_VERSION,
  VAULT_PBKDF2_ITERATIONS as PBKDF2_ITERATIONS,
  LEGACY_VAULT_PBKDF2_ITERATIONS as PBKDF2_ITERATIONS_LEGACY,
  DEFAULT_AUTO_LOCK_MS as AUTO_LOCK_DEFAULT_MS,
  KEEPALIVE_ALARM,
  KEEPALIVE_PERIOD_MIN,
} from '@constants/vault.ts';
/**
 * Encrypted Key Vault -- AES-256-GCM + PBKDF2
 *
 * Stores Nostr private keys encrypted at rest in chrome.storage.local.
 * Keys are only decrypted in memory when the vault is unlocked.
 *
 * Encryption scheme:
 *   1. password -> PBKDF2(SHA-256, 600,000 iterations, random 32-byte salt) -> 256-bit AES key
 *      ("Never lock" vaults use 210,000 — see iterationsFor)
 *   2. AES-256-GCM(key, random 12-byte IV, plaintext JSON) -> ciphertext + auth tag
 *   3. Stored as { version, salt, iv, ciphertext } in chrome.storage.local
 *
 * Security properties:
 *   - Auto-lock timer clears decrypted keys from memory
 *   - Chrome service worker termination naturally clears all memory
 *   - Private key bytes obtained via getPrivkey() must be zeroed by caller
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey -- Web Crypto: PBKDF2
 * @see https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt -- Web Crypto: AES-GCM
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html -- OWASP: PBKDF2 iteration recommendations
 *
 * @module services/vault/vault
 */

import type { VaultPayload, MemoryVaultPayload } from '../../domain/vault/types.ts';
import { arrayToBase64, base64ToArray } from '../../lib/crypto/utils.ts';
import browser from '@lib/browser.ts';
import { LOCK_STATE_KEY } from '@constants/vault.ts';

// All writes share one lane; synchronous invalidation always wins over queued work.
const mutations = new AsyncLock();
let sessionRevision = 0;
const destroyListeners = new Set<() => Promise<void>>();
export function onDestroy(listener: () => Promise<void>): () => void {
  destroyListeners.add(listener);
  return () => { destroyListeners.delete(listener); };
}
const unlockListeners = new Set<() => Promise<void>>();
export function onUnlock(listener: () => Promise<void>): () => void {
  unlockListeners.add(listener);
  return () => { unlockListeners.delete(listener); };
}
async function notifyUnlocked(): Promise<void> {
  for (const listener of unlockListeners) {
    try { await listener(); } catch { console.warn('[Vault] Private cache migration deferred'); }
  }
}

const lockListeners = new Set<() => void>();
const sessionListeners = new Set<() => void>();
export function getSessionRevision(): number { return sessionRevision; }
export function onLock(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => { lockListeners.delete(listener); };
}
export function onSessionInvalidated(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}
function invalidateSession(): void {
  sessionRevision++;
  for (const listener of sessionListeners) {
    try { listener(); } catch { /* Revocation must continue for other holders. */ }
  }
}
function assertRevision(revision: number): void {
  if (revision !== sessionRevision) throw new Error('Vault session changed');
}

let cacheKeyReady = false;
let _cryptoKey: CryptoKey | null = null;
let _decrypted: MemoryVaultPayload | null = null;
let _autoLockTimer: ReturnType<typeof setTimeout> | null = null;
let _autoLockMs: number = AUTO_LOCK_DEFAULT_MS;
// Work factor `_cryptoKey` was derived with, so save() rewrites the record with the
// count that actually matches the key held in memory.
let _kdfIterations: number = PBKDF2_ITERATIONS;

/**
 * Zero all in-memory key material in the current decrypted payload (if any).
 * Called on lock() and before any code path REPLACES `_decrypted` (create()
 * during password/lock-mode transitions, unlock() while already unlocked) so
 * stale key bytes never linger in the heap.
 */
function zeroDecryptedKeys(): void {
  if (!_decrypted) return;
  cacheKeyReady = false;
  _decrypted.cacheKeyBytes?.fill(0);
  for (const acct of _decrypted.accounts) {
    if (acct.privkeyBytes) acct.privkeyBytes.fill(0);
    if (acct.mnemonicBytes) acct.mnemonicBytes.fill(0);
    if (acct.pqKemSecretBytes) acct.pqKemSecretBytes.fill(0);
    if (acct.pqDsaSecretBytes) acct.pqDsaSecretBytes.fill(0);
  }
}

function resetAutoLock(): void {
  if (_autoLockTimer) clearTimeout(_autoLockTimer);
  if (_cryptoKey && _autoLockMs > 0) {
    _autoLockTimer = setTimeout(() => lock(), _autoLockMs);
    // Don't keep Node.js process alive just for auto-lock (matters in tests)
    if (typeof _autoLockTimer === 'object' && 'unref' in _autoLockTimer) {
      (_autoLockTimer as NodeJS.Timeout).unref();
    }
  }
}

/**
 * Arm a periodic alarm that keeps the Chrome MV3 service worker alive while the
 * vault is unlocked in timed-lock mode. Without this the SW can be torn down
 * (e.g. on page refresh) long before the auto-lock interval, wiping the
 * in-memory key and making the vault appear locked prematurely (bug #10).
 *
 * We do NOT persist the decrypted key — only hold the SW open. No-op where
 * browser.alarms is unavailable (Safari persistent background page, tests).
 */
function armKeepAlive(): void {
  if (_autoLockMs <= 0) return; // "Never lock" mode auto-unlocks on restart anyway
  const alarms = (browser as typeof chrome).alarms;
  if (!alarms?.create) return;
  try {
    // The promise-based signature can reject as well as throw synchronously
    // (e.g. missing "alarms" permission) — catch both the same "no-op" way.
    alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_PERIOD_MIN })?.catch(() => {});
  } catch { /* no-op where alarms are unavailable */ }
}

/** Clear the keep-alive alarm. No-op where browser.alarms is unavailable. */
function clearKeepAlive(): void {
  const alarms = (browser as typeof chrome).alarms;
  if (!alarms?.clear) return;
  try {
    alarms.clear(KEEPALIVE_ALARM)?.catch(() => {});
  } catch { /* no-op where alarms are unavailable */ }
}

// -- Public API --

/**
 * Create a new vault with the given password and accounts.
 *
 * An empty password is intentional for "Never lock" mode: the vault is still
 * AES-256-GCM encrypted (PBKDF2 derives a key from the empty string), so data
 * at rest in chrome.storage.local is not plaintext. The empty password is only
 * used to auto-unlock on service worker restart -- the threat model here is that
 * if someone has access to chrome.storage.local they could also read the
 * extension's source and extract the empty password, so the encryption serves
 * as a defense-in-depth layer rather than a strong secret. Users who want real
 * password protection choose a timed auto-lock with a non-empty password.
 *
 * @param password - vault password (empty string for "Never lock" mode)
 * @param payload - { accounts: [...], activeAccountId: string }
 */
export async function create(password: string, payload: VaultPayload): Promise<void> {
  invalidateSession();
  const revision = sessionRevision;
  return mutations.run(async () => {
    assertRevision(revision);
    // Enforce minimum password length when lockable (non-empty password)
    if (password.length > 0 && password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    cacheKeyReady = false;
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const iterations = iterationsFor(password);
    const key = await deriveKey(password, salt, iterations);
    const cacheKey = payload.cacheKey || (_decrypted?.cacheKeyBytes ? arrayToBase64(_decrypted.cacheKeyBytes) : arrayToBase64(crypto.getRandomValues(new Uint8Array(32))));
    const json = JSON.stringify({ ...payload, cacheKey });
    const { iv, ciphertext } = await encrypt(key, json);

    assertRevision(revision);
    await browser.storage.local.set({
      [STORAGE_KEY]: {
        version: VAULT_VERSION,
        iterations,
        salt: arrayToBase64(salt),
        iv: arrayToBase64(iv),
        ciphertext: arrayToBase64(ciphertext)
      }
    });

    assertRevision(revision);
    _cryptoKey = key;
    _kdfIterations = iterations;
    // Password-change / lock-mode transitions call create() while already
    // unlocked: zero the old key buffers before dropping the reference.
    zeroDecryptedKeys();
    _decrypted = {
      cacheKeyBytes: base64ToArray(cacheKey),
      accounts: payload.accounts.map(toMemoryAccount),
      activeAccountId: payload.activeAccountId,
    };
    cacheKeyReady = true;
    resetAutoLock();
    armKeepAlive();
    await notifyUnlocked();
  });
}

/**
 * Unlock the vault with a password
 * @param password
 * @returns true if unlock succeeded
 */
export async function unlock(password: string): Promise<boolean> {
  const revision = sessionRevision;
  return mutations.run(async () => {
    if (revision !== sessionRevision) return false;
    const data = await browser.storage.local.get(STORAGE_KEY);
    const vault = data[STORAGE_KEY] as
      { salt: string; iv: string; ciphertext: string; iterations?: number } | undefined;
    if (!vault) throw new Error('No vault found');

    const salt = base64ToArray(vault.salt);
    const iv = base64ToArray(vault.iv);
    const ciphertext = base64ToArray(vault.ciphertext);

    // Records written before the work factor was raised carry no `iterations` field;
    // they were all written at the legacy count. Reading it from the record means the
    // migration costs no extra KDF work and no guessing.
    const storedIterations = typeof vault.iterations === 'number'
      ? vault.iterations
      : PBKDF2_ITERATIONS_LEGACY;
    const key = await deriveKey(password, salt, storedIterations);

    try {
      const json = await decrypt(key, iv, ciphertext);
      assertRevision(revision);
      const parsed = JSON.parse(json) as VaultPayload;
      // Password re-verification while already unlocked (e.g. change-password
      // flow) replaces _decrypted: zero the old buffers first. Only done AFTER a
      // successful decrypt — a failed unlock must not wipe the current session.
      zeroDecryptedKeys();
      _decrypted = {
        cacheKeyBytes: parsed.cacheKey ? base64ToArray(parsed.cacheKey) : crypto.getRandomValues(new Uint8Array(32)),
        accounts: parsed.accounts.map(toMemoryAccount),
        activeAccountId: parsed.activeAccountId,
      };
      _cryptoKey = key;
      _kdfIterations = storedIterations;
      resetAutoLock();
      armKeepAlive();

      // Announce the unlock, not just the lock. On a "Never lock" vault the
      // background auto-unlocks on every cold start, and a popup that opened
      // during that window was told "locked" with no way to ever hear the
      // correction — so it hid the wallet card and every locked-gated action for
      // as long as it stayed open.


      // Transparent upgrade: the password is in hand exactly once, here. Re-encrypting
      // now is the only moment we can raise the work factor without asking the user for
      // anything. reEncrypt() replaces _cryptoKey and _kdfIterations.
      const target = iterationsFor(password);
      if (storedIterations < target) {
        try {
          await reEncryptNow(password, revision);
        } catch (e) {
          // A failed upgrade must never cost the user their unlocked session — the
          // vault is already open and the old record is still valid.
          console.warn('[VAULT] KDF upgrade failed, keeping existing record:', (e as Error).message);
        }
      }
      if (!parsed.cacheKey) {
        try { await saveNow(revision); } catch (error) {
          if (revision === sessionRevision) lock();
          throw error;
        }
      }
      cacheKeyReady = true;
      await notifyUnlocked();
      assertRevision(revision);
      noteLockStateChanged();
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Restore the configured auto-lock interval from storage and (re)arm the timer.
 *
 * `_autoLockMs` is module-level in-memory state that resets to
 * AUTO_LOCK_DEFAULT_MS (15 min) on every service-worker cold start. Without
 * re-reading the persisted `autoLockMs`, a configured interval silently reverts
 * to 15 minutes after the SW restarts (bug #10). Call this after a successful
 * unlock and on background startup so the user's chosen interval — not the
 * default — governs locking.
 */
export async function restoreAutoLockSetting(): Promise<void> {
  const data = await browser.storage.local.get(['autoLockMs']) as Record<string, number>;
  _autoLockMs = data.autoLockMs ?? AUTO_LOCK_DEFAULT_MS;
  resetAutoLock();
  // Re-sync keep-alive to the restored mode (only relevant when already unlocked).
  if (_cryptoKey && _autoLockMs > 0) {
    armKeepAlive();
  } else {
    clearKeepAlive();
  }
}

/**
 * Lock the vault -- clear decrypted data from memory
 */
export function lock(): void {
  invalidateSession();
  zeroDecryptedKeys();
  _decrypted = null;
  _cryptoKey = null;
  if (_autoLockTimer) {
    clearTimeout(_autoLockTimer);
    _autoLockTimer = null;
  }
  clearKeepAlive();

  // Locking left no trace an open popup could see. Auto-lock fires on a
  // background timer, so a popup sitting open past the interval went on
  // rendering unlocked UI over a locked vault — and an incoming request that
  // queued an unlock waiter got no unlock prompt at all, because the surface
  // that raises one only does so when it believes the vault is locked. It just
  // timed out. Writing here is what the popup's listener has to observe.
  //
  // Fire-and-forget: locking must not depend on a storage write succeeding.
  noteLockStateChanged();
  for (const listener of lockListeners) {
    try { listener(); } catch { /* One cleanup must not prevent another. */ }
  }
}

/**
 * Bump the marker an open popup watches for lock-state changes.
 *
 * Fire-and-forget in both directions: neither locking nor unlocking may depend
 * on a storage write succeeding.
 */
function noteLockStateChanged(): void {
  browser.storage.local.set({ [LOCK_STATE_KEY]: Date.now() }).catch(() => {});
}

/**
 * Check if the vault is locked
 */
export function isLocked(): boolean {
  return _decrypted === null;
}

// -- Startup auto-unlock gate --
//
// In "Never lock" mode background.ts auto-unlocks the vault on every
// service-worker cold start, and that unlock is asynchronous: a storage read
// plus PBKDF2 at 210,000 iterations, so the vault reports LOCKED for a few
// hundred milliseconds after startup. Chrome tears the worker down after ~30s
// idle, so an ordinary signEvent from a page routinely lands inside that
// window. Without this gate the request path saw `isLocked() === true`, queued
// an unlock marker and popped the action popup open — for an unlock the user
// never had to perform, on a request their saved permission had already
// approved. Request paths await this before treating the vault as locked.

let _startupUnlock: Promise<void> | null = null;

/**
 * Run the background's startup auto-unlock, exposing it to request paths so a
 * cold-start window is not mistaken for a locked vault.
 * @param run - the auto-unlock sequence; its rejection is swallowed (a failed
 *              auto-unlock just means the vault stays locked and prompts).
 */
export function beginStartupUnlock(run: () => Promise<void>): Promise<void> {
  const p = run().catch(() => {}).then(() => {
    if (_startupUnlock === p) _startupUnlock = null;
  });
  _startupUnlock = p;
  return p;
}

/** Resolves once any in-flight startup auto-unlock has settled. */
export function whenStartupUnlockSettled(): Promise<void> {
  return _startupUnlock || Promise.resolve();
}

/**
 * Destroy the vault -- wipe encrypted data from storage and clear memory.
 * This is irreversible: all accounts and keys are permanently lost.
 */
export async function destroy(): Promise<void> {
  lock();
  await mutations.run(async () => {
    await browser.storage.local.remove(STORAGE_KEY);
    for (const listener of destroyListeners) await listener();
  });
}

/**
 * Check if a vault exists in storage
 */
export async function exists(): Promise<boolean> {
  const data = await browser.storage.local.get(STORAGE_KEY);
  return !!data[STORAGE_KEY];
}

/**
 * Set auto-lock timeout
 * @param ms - milliseconds (0 to disable)
 */
export function setAutoLockTimeout(ms: number): void {
  _autoLockMs = ms;
  if (ms === 0) {
    console.warn('[Vault] Auto-lock disabled. Vault encrypted with empty password — reduced security.');
  }
  resetAutoLock();
  // Keep-alive only runs in timed mode while unlocked; re-sync it to the new mode.
  if (_cryptoKey && ms > 0) {
    armKeepAlive();
  } else {
    clearKeepAlive();
  }
}

/**
 * Re-encrypt the vault with a new password.
 * Keeps the unlocked session alive rather than tearing it down and rebuilding it. It
 * does still serialize the payload once (hex keys as JS strings, unavoidable before
 * encryption) — an earlier comment here claimed otherwise, which was simply wrong.
 * @param newPassword - new vault password
 */
export async function reEncrypt(newPassword: string): Promise<void> {
  const revision = sessionRevision;
  return mutations.run(() => reEncryptNow(newPassword, revision));
}

async function reEncryptNow(newPassword: string, revision: number): Promise<void> {
  assertRevision(revision);
  if (!_cryptoKey || !_decrypted) throw new Error('Vault is locked');
  if (newPassword.length > 0 && newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iterations = iterationsFor(newPassword);
  const newKey = await deriveKey(newPassword, salt, iterations);
  assertRevision(revision);
  const json = JSON.stringify(toStoragePayload(_decrypted));
  const { iv, ciphertext } = await encrypt(newKey, json);

  assertRevision(revision);
  await browser.storage.local.set({
    [STORAGE_KEY]: {
      version: VAULT_VERSION,
      iterations,
      salt: arrayToBase64(salt),
      iv: arrayToBase64(iv),
      ciphertext: arrayToBase64(ciphertext)
    }
  });

  assertRevision(revision);
  _cryptoKey = newKey;
  _kdfIterations = iterations;
  resetAutoLock();
}

/**
 * Re-encrypt and save vault to storage
 */
async function save(): Promise<void> {
  const revision = sessionRevision;
  return mutations.run(() => saveNow(revision));
}

async function saveNow(revision: number): Promise<void> {
    assertRevision(revision);
    if (!_cryptoKey || !_decrypted) throw new Error('Vault is locked');

    const data = await browser.storage.local.get(STORAGE_KEY);
    const vault = data[STORAGE_KEY] as { salt: string };
    const salt = base64ToArray(vault.salt);

    assertRevision(revision);
    const json = JSON.stringify(toStoragePayload(_decrypted));
    const { iv, ciphertext } = await encrypt(_cryptoKey, json);

    // _kdfIterations, not the constant: this writes the record back under the key already
    // in memory, which may still be a legacy-count key if the upgrade has not run.
    assertRevision(revision);
    await browser.storage.local.set({
      [STORAGE_KEY]: {
        version: VAULT_VERSION,
        iterations: _kdfIterations,
        salt: arrayToBase64(salt),
        iv: arrayToBase64(iv),
        ciphertext: arrayToBase64(ciphertext)
      }
    });

    resetAutoLock();
}

export const { setImportedPqKeys, clearImportedPqKeys, withImportedPqKeys, hasImportedPqKeys } = createImportedKeyAccess(() => _decrypted, save);

export const {
  getActivePubkey, getActiveAccountId, getActiveAccount, getActiveAccountWithWallet,
  getDecryptedPayload, getPrivkey, withPrivkey, getAccountById, getAccountForRemoteSigning, listAccounts,
  addAccount, removeAccount, setActiveAccount, clearActiveAccount,
  updateAccountNip46Keys, updateAccountWalletConfig,
} = createAccountAccess(() => _decrypted, save, resetAutoLock, invalidateSession);

/** Wait through automatic startup recovery, then enforce the actual lock state. */
export async function requireUnlocked(): Promise<void> {
  await whenStartupUnlockSettled();
  if (isLocked()) throw new Error('Vault is locked');
}

/** Execute private-cache cryptography without exposing the key to RPC/UI callers. */
export async function withCacheKey<T>(operation: (key: CryptoKey) => Promise<T>): Promise<T> {
  if (!cacheKeyReady || !_decrypted?.cacheKeyBytes || !_cryptoKey) throw new Error('Vault is locked');
  const revision = sessionRevision;
  const bytes = _decrypted.cacheKeyBytes.slice();
  try {
    const key = await crypto.subtle.importKey('raw', bytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
    assertRevision(revision);
    const result = await operation(key);
    assertRevision(revision);
    return result;
  } finally { bytes.fill(0); }
}
