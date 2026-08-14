/**
 * Encrypted Key Vault -- AES-256-GCM + PBKDF2
 *
 * Stores Nostr private keys encrypted at rest in chrome.storage.local.
 * Keys are only decrypted in memory when the vault is unlocked.
 *
 * Encryption scheme:
 *   1. password -> PBKDF2(SHA-256, 210,000 iterations, random 32-byte salt) -> 256-bit AES key
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
 * @module lib/vault
 */

import type { VaultPayload, Account, SafeAccount, SafeAccountWithWallet, MemoryAccount, MemoryVaultPayload } from './types.ts';
import { hexToBytes, bytesToHex, arrayToBase64, base64ToArray } from './crypto/utils.ts';
import browser from './browser.ts';

const STORAGE_KEY = 'keyVault';
const VAULT_VERSION = 1;
const PBKDF2_ITERATIONS = 210000;
const AUTO_LOCK_DEFAULT_MS = 15 * 60 * 1000; // 15 minutes
const KEEPALIVE_ALARM = 'vault-keepalive';
// Chrome clamps alarm periods to a 30s (0.5 min) minimum; we just need any
// periodic wake to reset the service-worker idle timer while unlocked.
const KEEPALIVE_PERIOD_MIN = 0.5;

let _cryptoKey: CryptoKey | null = null;
let _decrypted: MemoryVaultPayload | null = null;
let _autoLockTimer: ReturnType<typeof setTimeout> | null = null;
let _autoLockMs: number = AUTO_LOCK_DEFAULT_MS;

/** Convert Account (JSON storage format) to MemoryAccount (in-memory format) */
function toMemoryAccount(acct: Account): MemoryAccount {
  const { privkey, mnemonic, ...rest } = acct;
  return {
    ...rest,
    privkeyBytes: privkey ? hexToBytes(privkey) : null,
    mnemonicBytes: mnemonic ? new TextEncoder().encode(mnemonic) : null,
  };
}

/** Convert MemoryAccount back to Account (JSON storage format) */
function toStorageAccount(acct: MemoryAccount): Account {
  const { privkeyBytes, mnemonicBytes, ...rest } = acct;
  return {
    ...rest,
    privkey: privkeyBytes ? bytesToHex(privkeyBytes) : null,
    mnemonic: mnemonicBytes ? new TextDecoder().decode(mnemonicBytes) : null,
  };
}

/** Convert MemoryVaultPayload back to VaultPayload for serialization */
function toStoragePayload(mem: MemoryVaultPayload): VaultPayload {
  return {
    accounts: mem.accounts.map(toStorageAccount),
    activeAccountId: mem.activeAccountId,
  };
}

/**
 * Derive an AES-256-GCM key from a password using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt plaintext with AES-256-GCM
 */
async function encrypt(key: CryptoKey, plaintext: string): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

/**
 * Decrypt ciphertext with AES-256-GCM
 */
async function decrypt(key: CryptoKey, iv: Uint8Array, ciphertext: Uint8Array): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource
  );
  return new TextDecoder().decode(plaintext);
}

/**
 * Zero all in-memory key material in the current decrypted payload (if any).
 * Called on lock() and before any code path REPLACES `_decrypted` (create()
 * during password/lock-mode transitions, unlock() while already unlocked) so
 * stale key bytes never linger in the heap.
 */
function zeroDecryptedKeys(): void {
  if (!_decrypted) return;
  for (const acct of _decrypted.accounts) {
    if (acct.privkeyBytes) acct.privkeyBytes.fill(0);
    if (acct.mnemonicBytes) acct.mnemonicBytes.fill(0);
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
    alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_PERIOD_MIN });
  } catch { /* no-op where alarms are unavailable */ }
}

/** Clear the keep-alive alarm. No-op where browser.alarms is unavailable. */
function clearKeepAlive(): void {
  const alarms = (browser as typeof chrome).alarms;
  if (!alarms?.clear) return;
  try {
    alarms.clear(KEEPALIVE_ALARM);
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
  // Enforce minimum password length when lockable (non-empty password)
  if (password.length > 0 && password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const key = await deriveKey(password, salt);
  const json = JSON.stringify(payload);
  const { iv, ciphertext } = await encrypt(key, json);

  await browser.storage.local.set({
    [STORAGE_KEY]: {
      version: VAULT_VERSION,
      salt: arrayToBase64(salt),
      iv: arrayToBase64(iv),
      ciphertext: arrayToBase64(ciphertext)
    }
  });

  _cryptoKey = key;
  // Password-change / lock-mode transitions call create() while already
  // unlocked: zero the old key buffers before dropping the reference.
  zeroDecryptedKeys();
  _decrypted = {
    accounts: payload.accounts.map(toMemoryAccount),
    activeAccountId: payload.activeAccountId,
  };
  resetAutoLock();
  armKeepAlive();
}

/**
 * Unlock the vault with a password
 * @param password
 * @returns true if unlock succeeded
 */
export async function unlock(password: string): Promise<boolean> {
  const data = await browser.storage.local.get(STORAGE_KEY);
  const vault = data[STORAGE_KEY] as { salt: string; iv: string; ciphertext: string } | undefined;
  if (!vault) throw new Error('No vault found');

  const salt = base64ToArray(vault.salt);
  const iv = base64ToArray(vault.iv);
  const ciphertext = base64ToArray(vault.ciphertext);

  const key = await deriveKey(password, salt);

  try {
    const json = await decrypt(key, iv, ciphertext);
    const parsed = JSON.parse(json) as VaultPayload;
    // Password re-verification while already unlocked (e.g. change-password
    // flow) replaces _decrypted: zero the old buffers first. Only done AFTER a
    // successful decrypt — a failed unlock must not wipe the current session.
    zeroDecryptedKeys();
    _decrypted = {
      accounts: parsed.accounts.map(toMemoryAccount),
      activeAccountId: parsed.activeAccountId,
    };
    _cryptoKey = key;
    resetAutoLock();
    armKeepAlive();
    return true;
  } catch {
    return false;
  }
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
  zeroDecryptedKeys();
  _decrypted = null;
  _cryptoKey = null;
  if (_autoLockTimer) {
    clearTimeout(_autoLockTimer);
    _autoLockTimer = null;
  }
  clearKeepAlive();
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
  await browser.storage.local.remove(STORAGE_KEY);
}

/**
 * Check if a vault exists in storage
 */
export async function exists(): Promise<boolean> {
  const data = await browser.storage.local.get(STORAGE_KEY);
  return !!data[STORAGE_KEY];
}

/**
 * Get the active account's pubkey (works even when locked by reading from config)
 */
export function getActivePubkey(): string | null {
  if (!_decrypted) return null;
  const acct = _decrypted.accounts.find(a => a.id === _decrypted!.activeAccountId);
  return acct?.pubkey || null;
}

/**
 * Get the active account ID
 */
export function getActiveAccountId(): string | null {
  return _decrypted?.activeAccountId || null;
}

/**
 * Get the active account
 */
export function getActiveAccount(): SafeAccount | null {
  if (!_decrypted) return null;
  const acct = _decrypted.accounts.find(a => a.id === _decrypted!.activeAccountId);
  if (!acct) return null;
  const { privkeyBytes, mnemonicBytes, ...safe } = acct;
  return safe;
}

/**
 * Get the active account including walletConfig (for background wallet handlers).
 * Unlike getActiveAccount() which omits walletConfig from its return type,
 * this includes it for use in wallet/WebLN handler code.
 */
export function getActiveAccountWithWallet(): SafeAccountWithWallet | null {
  if (!_decrypted) return null;
  const acct = _decrypted.accounts.find(a => a.id === _decrypted!.activeAccountId);
  if (!acct) return null;
  const { privkeyBytes, mnemonicBytes, ...safe } = acct;
  return safe;
}

/**
 * Get a deep copy of the decrypted vault payload
 * @throws {Error} if vault is locked
 */
export function getDecryptedPayload(): VaultPayload {
    if (!_decrypted) throw new Error('Vault is locked');
    return toStoragePayload(_decrypted);
}

/**
 * Get the private key bytes for a specific account
 * CALLER MUST ZERO THE RETURNED ARRAY AFTER USE
 * @param accountId - defaults to active account
 * @returns 32-byte private key
 */
export function getPrivkey(accountId?: string): Uint8Array | null {
  if (!_decrypted) throw new Error('Vault is locked');
  resetAutoLock();

  const id = accountId || _decrypted.activeAccountId;
  const acct = _decrypted.accounts.find(a => a.id === id);
  if (!acct || !acct.privkeyBytes) return null;

  // Return a copy so caller's fill(0) doesn't affect vault
  return new Uint8Array(acct.privkeyBytes);
}

/**
 * Get an account by ID (full object including nip46Config, but not privkey)
 * @param accountId
 * @returns Safe account without privkey, or null
 */
export function getAccountById(accountId: string): SafeAccount | null {
  if (!_decrypted || !accountId) return null;
  const acct = _decrypted.accounts.find(a => a.id === accountId);
  if (!acct) return null;
  // Return a copy without key bytes for safety
  const { privkeyBytes, mnemonicBytes, ...safe } = acct;
  return safe;
}

/**
 * Get all accounts (public metadata only, no keys)
 */
export function listAccounts(): Array<{ id: string; name: string; type: string; pubkey: string; readOnly: boolean; createdAt: number }> {
  if (!_decrypted) return [];
  return _decrypted.accounts.map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    pubkey: a.pubkey,
    readOnly: a.readOnly || !a.privkeyBytes,
    createdAt: a.createdAt
  }));
}

/**
 * Add an account to the vault
 * @param account
 */
export async function addAccount(account: Account): Promise<void> {
  if (!_decrypted) throw new Error('Vault is locked');
  if (_decrypted.accounts.some(a => a.id === account.id)) {
    throw new Error('Account already exists in vault');
  }
  _decrypted.accounts.push(toMemoryAccount(account));
  await save();
}

/**
 * Remove an account from the vault
 * @param accountId
 */
export async function removeAccount(accountId: string): Promise<void> {
  if (!_decrypted) throw new Error('Vault is locked');
  _decrypted.accounts = _decrypted.accounts.filter(a => a.id !== accountId);
  if (_decrypted.activeAccountId === accountId) {
    _decrypted.activeAccountId = _decrypted.accounts[0]?.id || null;
  }
  await save();
}

/**
 * Set the active account
 * @param accountId
 */
export async function setActiveAccount(accountId: string): Promise<void> {
  if (!_decrypted) throw new Error('Vault is locked');
  const acct = _decrypted.accounts.find(a => a.id === accountId);
  if (!acct) throw new Error('Account not found');
  _decrypted.activeAccountId = accountId;
  await save();
}

/**
 * Clear the vault's in-memory active account so getActiveAccount() returns null.
 * Used when switching to an account not in the vault (read-only/npub).
 * Does NOT persist -- vault re-reads on next unlock.
 */
export function clearActiveAccount(): void {
  if (_decrypted) {
    _decrypted.activeAccountId = null;
  }
}

/**
 * Update the NIP-46 ephemeral keypair for an account (persists to vault).
 * Called after first NIP-46 connect to store the generated keypair so
 * reconnects after service worker restart use the same identity.
 */
export async function updateAccountNip46Keys(accountId: string, localPrivkey: string, localPubkey: string): Promise<void> {
  if (!_decrypted) throw new Error('Vault is locked');
  const acct = _decrypted.accounts.find(a => a.id === accountId);
  if (!acct || !acct.nip46Config) throw new Error('Account not found or not NIP-46');
  acct.nip46Config = { ...acct.nip46Config, localPrivkey, localPubkey };
  await save();
}

/**
 * Update the wallet config for an account (persists to vault).
 * Pass null to remove wallet config.
 */
export async function updateAccountWalletConfig(
  accountId: string,
  walletConfig: Account['walletConfig'] | null,
): Promise<void> {
  if (!_decrypted) throw new Error('Vault is locked');
  const acct = _decrypted.accounts.find(a => a.id === accountId);
  if (!acct) throw new Error('Account not found');
  if (walletConfig === null) {
    delete acct.walletConfig;
  } else {
    acct.walletConfig = walletConfig;
  }
  await save();
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
 * Avoids JSON round-trip of private keys (no intermediate hex strings).
 * @param newPassword - new vault password
 */
export async function reEncrypt(newPassword: string): Promise<void> {
  if (!_cryptoKey || !_decrypted) throw new Error('Vault is locked');
  if (newPassword.length > 0 && newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const salt = crypto.getRandomValues(new Uint8Array(32));
  const newKey = await deriveKey(newPassword, salt);
  const json = JSON.stringify(toStoragePayload(_decrypted));
  const { iv, ciphertext } = await encrypt(newKey, json);

  await browser.storage.local.set({
    [STORAGE_KEY]: {
      version: VAULT_VERSION,
      salt: arrayToBase64(salt),
      iv: arrayToBase64(iv),
      ciphertext: arrayToBase64(ciphertext)
    }
  });

  _cryptoKey = newKey;
  resetAutoLock();
}

/**
 * Re-encrypt and save vault to storage
 */
async function save(): Promise<void> {
  if (!_cryptoKey || !_decrypted) throw new Error('Vault is locked');

  const data = await browser.storage.local.get(STORAGE_KEY);
  const vault = data[STORAGE_KEY] as { salt: string };
  const salt = base64ToArray(vault.salt);

  const json = JSON.stringify(toStoragePayload(_decrypted));
  const { iv, ciphertext } = await encrypt(_cryptoKey, json);

  await browser.storage.local.set({
    [STORAGE_KEY]: {
      version: VAULT_VERSION,
      salt: arrayToBase64(salt),
      iv: arrayToBase64(iv),
      ciphertext: arrayToBase64(ciphertext)
    }
  });

  resetAutoLock();
}
