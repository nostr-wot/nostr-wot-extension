/**
 * NIP-07 Signer -- Request Coordinator with In-Popup Approval
 *
 * Handles all NIP-07 signing requests from web pages, coordinating between
 * the vault (key storage), permissions (allow/deny policies), and the
 * popup approval overlay (user authorization).
 *
 * Signing flow:
 *   1. Web page calls window.nostr.signEvent(event)
 *   2. inject.js posts NIP07_REQUEST to content script
 *   3. content.js forwards to background.js with origin
 *   4. background.js routes to signer.js
 *   5. signer checks permissions (even if locked)
 *   6. if permission is 'ask', queues request for popup approval (badge shown)
 *   7. if permission is 'allow' but vault locked, queues as waitingForUnlock
 *   8. user opens popup, sees pending requests, approves/denies
 *   9. vault.getPrivkey() -> sign -> zero key bytes -> return signed event
 *
 * Permissions are account-type-agnostic (allow/deny/ask). After permission
 * is granted, routing is based on account type: NIP-46 forwards to remote
 * signer, local accounts sign with the vault.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/07.md
 * @module lib/signer
 */

import type { RequestDecision, PendingRequest, UnsignedEvent, SignedEvent, SafeAccount, AccountType } from './types.ts';
import browser from './browser.ts';
import { openPopupForActiveTab } from './openPopupForActiveTab.ts';
import { isDomainAllowed } from './bg/domain-handlers.ts';
import * as vault from './vault.ts';
import * as permissions from './permissions.ts';
import { AsyncLock } from './utils/async-lock.ts';
import { SIGNER_REQUEST_TIMEOUT_MS, VAULT_POLL_INTERVAL_MS, GET_PUBLIC_KEY_COOLDOWN_MS } from './constants.ts';
import { signEvent as cryptoSignEvent } from './crypto/nip01.ts';
import { bytesToHex, hexToBytes, randomBytes } from './crypto/utils.ts';
import { getPublicKey } from './crypto/secp256k1.ts';
import { nip04Encrypt, nip04Decrypt } from './crypto/nip04.ts';
import { nip44Encrypt, nip44Decrypt, getConversationKey } from './crypto/nip44.ts';
import { derivePqKeys, pqEncrypt, pqDecrypt, isPqEnvelope } from './crypto/pq.ts';
import { base64ToArray } from './crypto/utils.ts';
import { mnemonicToSeed } from './crypto/bip39.ts';
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';

// In-memory resolvers for pending requests (keyed by request ID)
const _pendingResolvers: Map<string, (decision: RequestDecision) => void> = new Map();
let _requestCounter: number = 0;

const REQUEST_TIMEOUT_MS = SIGNER_REQUEST_TIMEOUT_MS;
const _timeoutTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

// Cap on concurrently-pending ACTIONABLE requests per origin. Blunts
// popup-spam / DoS from a connected tab: once an origin has this many
// unresolved prompts, further queueRequest calls are rejected immediately.
const MAX_PENDING_PER_ORIGIN = 5;

// Vault unlock waiters -- independent of _pendingResolvers for resilience
const _unlockWaiters: Map<string, { resolve: () => void; reject: (err: Error) => void }> = new Map();

// Shared async lock for session storage writes
const _lock = new AsyncLock();

// NIP-46 client instances (keyed by account ID)
const _nip46Clients: Map<string, BunkerSigner> = new Map();

// Per-origin getPublicKey cooldown (origin → expiresAt epoch ms).
// After the user approves a getPublicKey request, additional getPublicKey calls
// from the same origin auto-approve until expiresAt. Cleared on account switch
// and on cleanupStale.
const _getPubkeyCooldown: Map<string, number> = new Map();

function isGetPubkeyCooldownActive(origin: string): boolean {
  const expires = _getPubkeyCooldown.get(origin);
  if (!expires) return false;
  if (Date.now() < expires) return true;
  _getPubkeyCooldown.delete(origin);
  return false;
}

/**
 * Invalidate the getPublicKey auto-approve cooldown.
 * Call when permissions for the origin are explicitly changed by the user
 * so the cooldown cannot outlive a revoke.
 * @param origin - origin to clear; if omitted, clears all origins.
 */
export function clearGetPubkeyCooldown(origin?: string): void {
  if (origin) _getPubkeyCooldown.delete(origin);
  else _getPubkeyCooldown.clear();
}

// NIP-46 abort controllers (keyed by nip46 request ID)
const _nip46Aborts: Map<string, AbortController> = new Map();

function raceAbort<T>(signal: AbortSignal, promise: Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Cancelled by user'));
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Cancelled by user')), { once: true });
    promise.then(resolve, reject);
  });
}

/**
 * Get info about the currently active account for permission checks.
 *
 * storage.local.activeAccountId is the SINGLE SOURCE OF TRUTH for which account
 * is active.  The vault's internal activeAccountId can diverge after service-worker
 * restarts + auto-unlock, so we never trust it here.
 */
async function getActiveAccountInfo(): Promise<{ accountId: string | null; accountType: AccountType | null }> {
  const data = await browser.storage.local.get(['accounts', 'activeAccountId']);
  const accountId: string | null = data.activeAccountId as string | null;

  if (!accountId) {
    return { accountId: null, accountType: null };
  }

  // Look up account type from the accounts list (covers all account types)
  const storageAcct = ((data.accounts || []) as Array<{ id: string; type?: string }>).find((a: { id: string; type?: string }) => a.id === accountId);
  if (storageAcct) {
    return { accountId, accountType: (storageAcct.type || 'generated') as AccountType };
  }

  // Account ID set but not found in accounts array -- shouldn't happen
  return { accountId, accountType: null };
}

/**
 * Get the active account's public key
 * @returns hex pubkey
 */
export async function getActivePublicKey(): Promise<string | null> {
  // storage.sync.myPubkey is the canonical source -- always updated by switchAccount/loadConfig
  const data = await browser.storage.sync.get('myPubkey');
  if (data.myPubkey) return data.myPubkey as string;

  // Fallback to vault (e.g., during initial setup before sync storage is set)
  return vault.getActivePubkey();
}

/**
 * Handle getPublicKey request with permission check
 */
export async function handleGetPublicKey(origin: string): Promise<string | null> {
  const { accountId } = await getActiveAccountInfo();
  const decision = await permissions.check(origin, 'getPublicKey', undefined, accountId ?? undefined);
  if (decision === 'deny') throw new Error('Permission denied');

  if (decision === 'ask') {
    // Connecting a site IS the consent to share the identity pubkey: the
    // "Connect this site" flow adds the origin to allowedDomains AND clears
    // identityDisabled for it, background.ts refuses every NIP-07 method from
    // an origin that is not on that list, and broadcastAccountChanged already
    // pushes the active pubkey to every connected tab unprompted. Asking again
    // here re-requested permission the user had already given — and since a
    // plain "Allow" persisted nothing but the 60s in-memory cooldown, the
    // prompt (and the popup it auto-opens) came back on every service-worker
    // restart, account switch, or page load a minute later.
    //
    // Both opt-outs still win over this: an explicit 'deny' is handled above,
    // and lib/bg/nip07-handlers.ts rejects the call before it reaches us when
    // identity is disabled for the site.
    if (await isDomainAllowed(origin)) {
      return getActivePublicKey();
    }
    if (isGetPubkeyCooldownActive(origin)) {
      return getActivePublicKey();
    }
    // Snapshot the identity shown in the prompt. The user approves sharing THIS
    // pubkey — if the active account changes while the prompt is pending, the
    // request must be rejected rather than resolved with the new account's key.
    const pubkey = await getActivePublicKey();
    const approved = await queueRequest({
      type: 'getPublicKey',
      origin,
      pubkey: pubkey ?? undefined,
      permKey: permissions.permissionKey('getPublicKey'),
      needsPermission: true,
      accountId,
    });
    if (!approved.allow) throw new Error('User denied access');
    const { accountId: nowActiveId } = await getActiveAccountInfo();
    if (nowActiveId !== accountId) throw new Error('Account switched');
    _getPubkeyCooldown.set(origin, Date.now() + GET_PUBLIC_KEY_COOLDOWN_MS);
    return pubkey;
  }

  // getPublicKey is always local (we know the pubkey for all account types)
  return getActivePublicKey();
}

/**
 * Invalidate signer state when the active account changes.
 *
 * EVERY code path that changes the active account (switchAccount,
 * vault_setActiveAccount, vault_removeAccount of the active account, and the
 * onboarding create/add/save-read-only flows) must call this so a site can
 * never receive the new account's identity or signature from a prompt that was
 * queued (and shown to the user) for the old one.
 *
 * @param previousAccountId - account that was active before the change
 * @param newAccountId - account that is active after the change
 */
export async function onActiveAccountChanged(
  previousAccountId?: string | null,
  newAccountId?: string | null,
): Promise<void> {
  clearGetPubkeyCooldown();
  if (previousAccountId && previousAccountId !== newAccountId) {
    await rejectPendingForAccount(previousAccountId);
  }
}

// -- Pending Request Queue --

interface QueueRequestInput {
  type: string;
  origin: string;
  pubkey?: string;
  event?: Partial<UnsignedEvent>;
  theirPubkey?: string;
  permKey?: string | null;
  eventKind?: number;
  needsPermission?: boolean;
  waitingForUnlock?: boolean;
  nip46InFlight?: boolean;
  accountId?: string | null;
  walletAmount?: number;        // For WebLN payment approval
}

export async function queueRequest(request: QueueRequestInput): Promise<RequestDecision> {
  const id = `req_${crypto.randomUUID()}`;
  const entry: PendingRequest = { id, ...request, timestamp: Date.now() };

  // Serialized storage write to prevent concurrent read-modify-write races
  let limitExceeded = false;
  await _lock.run(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = (data.signerPending as PendingRequest[] | undefined) || [];
    // Per-origin cap: reject when the origin already has too many actionable
    // (user-facing) prompts pending. In-flight NIP-46 tracking entries and
    // unlock markers don't count — they need no user action.
    const actionableFromOrigin = pending.filter(
      r => r.origin === request.origin && !r.nip46InFlight && !r.waitingForUnlock
    ).length;
    if (actionableFromOrigin >= MAX_PENDING_PER_ORIGIN) {
      limitExceeded = true;
      return;
    }
    pending.push(entry);
    await browser.storage.session.set({ signerPending: pending });
    // Don't update badge for NIP-46 in-flight (no user action needed)
    if (!request.nip46InFlight) {
      await updateBadge(pending.filter(r => !r.nip46InFlight).length);
    }
  });
  if (limitExceeded) {
    throw new Error('Too many pending requests from this origin');
  }

  // Notify popup (fire-and-forget, popup may not be open)
  browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});

  // Auto-open the popup only if the request needs user action and is from the active tab
  if (!request.nip46InFlight) {
    await openPopupForActiveTab(request.origin);
  }

  // Return promise that resolves when popup decides (not used for nip46InFlight)
  return new Promise((resolve, reject) => {
    _pendingResolvers.set(id, resolve);

    const timer = setTimeout(() => {
      _pendingResolvers.delete(id);
      _timeoutTimers.delete(id);
      removePendingFromStorage(id);
      reject(new Error('Request timed out'));
    }, REQUEST_TIMEOUT_MS);
    _timeoutTimers.set(id, timer);
  });
}

/**
 * Queue a NIP-46 in-flight tracking entry (no badge, no popup).
 * @returns the entry ID
 */
async function queueNip46InFlight(request: QueueRequestInput): Promise<string> {
  const id = `nip46_${Date.now()}_${++_requestCounter}`;
  const entry: PendingRequest = { id, ...request, nip46InFlight: true, timestamp: Date.now() };

  await _lock.run(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = (data.signerPending as PendingRequest[] | undefined) || [];
    pending.push(entry);
    await browser.storage.session.set({ signerPending: pending });
    // No badge update for in-flight entries
  });

  browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});
  return id;
}

/**
 * Remove a NIP-46 in-flight tracking entry.
 */
async function removeNip46InFlight(id: string): Promise<void> {
  await _lock.run(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = ((data.signerPending as PendingRequest[] | undefined) || []).filter((r: PendingRequest) => r.id !== id);
    await browser.storage.session.set({ signerPending: pending });
  });
  browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});
}

/**
 * Cancel a NIP-46 in-flight request by aborting its signal and cleaning up storage.
 */
export async function cancelNip46InFlight(reqId: string): Promise<void> {
  const ac = _nip46Aborts.get(reqId);
  if (ac) ac.abort();
  await removeNip46InFlight(reqId);
}

async function updateBadge(count: number): Promise<void> {
  try {
    const text = count > 0 ? String(count) : '';
    await browser.action.setBadgeText({ text });
    if (count > 0) {
      await browser.action.setBadgeBackgroundColor({ color: '#f59e0b' });
    }
  } catch (e) {
    console.warn('[SIGNER] updateBadge failed:', (e as Error).message);
  }
}

async function removePendingFromStorage(id: string): Promise<void> {
  await _lock.run(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = ((data.signerPending as PendingRequest[] | undefined) || []).filter((r: PendingRequest) => r.id !== id);
    await browser.storage.session.set({ signerPending: pending });
    await updateBadge(pending.filter(r => !r.nip46InFlight).length);
  });
  browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});
}

/**
 * Resolve a single pending request by ID
 * @param id - request ID
 * @param decision - { allow: boolean, remember: boolean, rememberKind?: boolean }
 */
export function resolveRequest(id: string, decision: RequestDecision): void {
  const resolver = _pendingResolvers.get(id);
  if (resolver) {
    resolver(decision);
    _pendingResolvers.delete(id);
  }
  const timer = _timeoutTimers.get(id);
  if (timer) { clearTimeout(timer); _timeoutTimers.delete(id); }
  removePendingFromStorage(id);
}

/**
 * Resolve all pending requests matching origin + permKey.
 * Matches by the logical permission key (e.g. "sendMessages", "signEvent:1"),
 * so requests with different wire methods that share a permKey (nip04Encrypt
 * and nip44Encrypt both map to "sendMessages") are resolved together.
 * @param origin - requesting domain
 * @param permKey - logical permission key (e.g. "sendMessages", "signEvent:1")
 * @param decision - { allow: boolean, remember: boolean }
 */
export async function resolveBatch(origin: string, permKey: string, decision: RequestDecision): Promise<void> {
  const match = (r: PendingRequest) => r.origin === origin && r.permKey === permKey;
  await _lock.run(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = (data.signerPending as PendingRequest[] | undefined) || [];
    const matching = pending.filter(match);
    for (const req of matching) {
      const resolver = _pendingResolvers.get(req.id);
      if (resolver) {
        resolver(decision);
        _pendingResolvers.delete(req.id);
      }
      const timer = _timeoutTimers.get(req.id);
      if (timer) { clearTimeout(timer); _timeoutTimers.delete(req.id); }
    }
    const remaining = pending.filter(r => !match(r));
    await browser.storage.session.set({ signerPending: remaining });
    await updateBadge(remaining.filter(r => !r.nip46InFlight).length);
  });
  browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});
}

/**
 * Get all pending requests from session storage
 */
export async function getPending(): Promise<PendingRequest[]> {
  const data = await browser.storage.session.get('signerPending');
  return (data.signerPending as PendingRequest[] | undefined) || [];
}

/**
 * Called after vault is successfully unlocked.
 * Resolves all pending requests that were waiting for unlock only.
 */
export async function onVaultUnlocked(): Promise<void> {
  // Resolve direct unlock waiters (from waitForVaultUnlock)
  for (const [, waiter] of _unlockWaiters) {
    waiter.resolve();
  }
  _unlockWaiters.clear();

  // Also resolve any legacy queueRequest-based unlock waiters
  let hadWaiters = false;
  await _lock.run(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = (data.signerPending as PendingRequest[] | undefined) || [];
    const unlockWaiters = pending.filter(r => r.waitingForUnlock);
    for (const req of unlockWaiters) {
      const resolver = _pendingResolvers.get(req.id);
      if (resolver) {
        resolver({ allow: true, remember: false });
        _pendingResolvers.delete(req.id);
      }
      const timer = _timeoutTimers.get(req.id);
      if (timer) { clearTimeout(timer); _timeoutTimers.delete(req.id); }
    }
    if (unlockWaiters.length > 0) {
      hadWaiters = true;
      const remaining = pending.filter(r => !r.waitingForUnlock);
      await browser.storage.session.set({ signerPending: remaining });
      await updateBadge(remaining.filter(r => !r.nip46InFlight).length);
    }
  });
  if (hadWaiters) {
    browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});
  }
}

/**
 * Clean up stale pending requests on service worker startup.
 * Resolvers are lost on restart, so clear session storage.
 */
export async function cleanupStale(): Promise<void> {
  for (const timer of _timeoutTimers.values()) clearTimeout(timer);
  _timeoutTimers.clear();
  _pendingResolvers.clear();
  _unlockWaiters.clear();
  _getPubkeyCooldown.clear();
  await _lock.run(async () => {
    await browser.storage.session.set({ signerPending: [] });
    await updateBadge(0);
  });
}

/**
 * Reject all pending requests for a specific account.
 * Called when switching accounts to prevent signing with the wrong key.
 * @param accountId
 */
export async function rejectPendingForAccount(accountId: string): Promise<void> {
  if (!accountId) return;
  // Account-switch invalidates any cooldown — never silently return the previous
  // account's pubkey to a site after the user switched accounts.
  _getPubkeyCooldown.clear();
  await _lock.run(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = (data.signerPending as PendingRequest[] | undefined) || [];
    const forAccount = pending.filter(r => r.accountId === accountId);
    for (const req of forAccount) {
      const resolver = _pendingResolvers.get(req.id);
      if (resolver) {
        resolver({ allow: false, reason: 'Account switched' });
        _pendingResolvers.delete(req.id);
      }
      const timer = _timeoutTimers.get(req.id);
      if (timer) { clearTimeout(timer); _timeoutTimers.delete(req.id); }
    }
    const remaining = pending.filter(r => r.accountId !== accountId);
    await browser.storage.session.set({ signerPending: remaining });
    await updateBadge(remaining.filter(r => !r.nip46InFlight).length);
  });
  browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});
}

/**
 * Cancel all unlock waiters and remove them from storage.
 * Called when user clicks Cancel on the unlock modal.
 */
export async function cancelAllUnlockWaiters(): Promise<void> {
  const error = new Error('Cancelled by user');
  for (const [, waiter] of _unlockWaiters) {
    waiter.reject(error);
  }
  _unlockWaiters.clear();
  await _lock.run(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = ((data.signerPending as PendingRequest[] | undefined) || [])
      .filter((r: PendingRequest) => !r.waitingForUnlock);
    await browser.storage.session.set({ signerPending: pending });
    await updateBadge(pending.filter(r => !r.nip46InFlight).length);
  });
  browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});
}

/**
 * Cancel a single unlock waiter by marker ID.
 */
export async function cancelUnlockWaiter(markerId: string): Promise<void> {
  const waiter = _unlockWaiters.get(markerId);
  if (waiter) {
    waiter.reject(new Error('Cancelled by user'));
    _unlockWaiters.delete(markerId);
  }
  await removePendingFromStorage(markerId);
}

/**
 * Wait for the vault to be unlocked.
 * Adds a marker to session storage so the popup knows to show the unlock modal,
 * then blocks until onVaultUnlocked() fires OR vault.isLocked() returns false.
 * Independent of _pendingResolvers -- survives service worker state changes.
 */
async function waitForVaultUnlock(origin: string, type: string, accountId: string | null): Promise<void> {
  if (!vault.isLocked()) return;

  const markerId = `unlock_${crypto.randomUUID()}`;
  const marker: PendingRequest = {
    id: markerId,
    type,
    origin,
    waitingForUnlock: true,
    needsPermission: false,
    accountId,
    timestamp: Date.now(),
  };

  // Add unlock marker to session storage so popup shows unlock modal
  await _lock.run(async () => {
    const data = await browser.storage.session.get('signerPending');
    const pending: PendingRequest[] = (data.signerPending as PendingRequest[] | undefined) || [];
    pending.push(marker);
    await browser.storage.session.set({ signerPending: pending });
  });
  browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});

  // Open the popup so the user sees the unlock modal — but only when the request
  // is from the tab they're looking at, so a background/inactive tab signing
  // request doesn't pop the popup open.
  await openPopupForActiveTab(origin);

  try {
    // Wait for unlock via direct callback OR polling fallback
    await new Promise<void>((resolve, reject) => {
      // Primary: resolved by onVaultUnlocked() or cancelled by cancelUnlockWaiter()
      const done = () => {
        _unlockWaiters.delete(markerId);
        clearTimeout(timer);
        clearInterval(poller);
        resolve();
      };
      const fail = (err: Error) => {
        _unlockWaiters.delete(markerId);
        clearTimeout(timer);
        clearInterval(poller);
        reject(err);
      };
      _unlockWaiters.set(markerId, { resolve: done, reject: fail });

      // Fallback: poll vault.isLocked() periodically
      const poller = setInterval(() => {
        if (!vault.isLocked()) done();
      }, VAULT_POLL_INTERVAL_MS);

      // Timeout after 2 minutes
      const timer = setTimeout(() => {
        _unlockWaiters.delete(markerId);
        clearInterval(poller);
        reject(new Error('Vault unlock timed out'));
      }, REQUEST_TIMEOUT_MS);
    });
  } finally {
    // Remove marker from session storage
    await _lock.run(async () => {
      const data = await browser.storage.session.get('signerPending');
      const pending: PendingRequest[] = ((data.signerPending as PendingRequest[] | undefined) || []).filter((r: PendingRequest) => r.id !== markerId);
      await browser.storage.session.set({ signerPending: pending });
      await updateBadge(pending.filter(r => !r.nip46InFlight).length);
    });
    browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});
  }
}

// -- NIP-07 Request Handlers --

/**
 * Handle signEvent request
 */
export async function handleSignEvent(event: UnsignedEvent, origin: string): Promise<SignedEvent> {
  const { accountId, accountType } = await getActiveAccountInfo();

  if (!(await vault.exists()) && accountType !== 'nip46') throw new Error('No signing key available');

  // Local permissions apply to ALL account types: an explicit per-origin 'deny'
  // must block even for NIP-46 accounts, BEFORE anything is routed to the
  // remote signer.
  const decision = await permissions.check(origin, 'signEvent', event.kind, accountId ?? undefined);
  if (decision === 'deny') throw new Error('Permission denied');

  // NIP-46 accounts skip the local 'ask' prompt — the remote signer (bunker)
  // runs its own approval flow for 'ask'/'allow'.
  if (accountType !== 'nip46' && decision === 'ask') {
    const pubkey = await getActivePublicKey();
    const approved = await queueRequest({
      type: 'signEvent',
      // Store the FULL content and FULL tags for every kind — the approval
      // prompt must show exactly what will be signed, so a site cannot hide
      // payload in long content or in tags of non-contact-list kinds.
      origin,
      event: { kind: event.kind, content: event.content, tags: event.tags },
      pubkey: pubkey ?? undefined,
      permKey: permissions.permissionKey('signEvent', event.kind),
      eventKind: event.kind,
      needsPermission: true,
      accountId,
    });
    if (!approved.allow) throw new Error('User denied signing');

    // Save permission and batch-resolve remaining requests if user chose "remember"
    if (approved.remember) {
      const kind = approved.rememberKind !== false ? event.kind : null;
      await permissions.save(origin, 'signEvent', kind ?? null, 'allow', accountId ?? undefined);
      // Batch-resolve remaining requests with the same permKey as the one just approved
      const batchPermKey = permissions.permissionKey('signEvent', event.kind);
      await resolveBatch(origin, batchPermKey, { allow: true, remember: false });
    }
  }

  // Route by account type
  if (accountType === 'nip46') {
    // NIP-46 needs vault unlocked to read nip46Config
    if (vault.isLocked()) {
      await waitForVaultUnlock(origin, 'signEvent', accountId);
    }
    if (vault.isLocked()) throw new Error('Vault is locked');
    const acct = vault.getAccountById(accountId!);
    if (!acct || acct.type !== 'nip46') throw new Error('No NIP-46 account active');
    const nip46ReqId = await queueNip46InFlight({ type: 'signEvent', origin, accountId });
    const ac = new AbortController();
    _nip46Aborts.set(nip46ReqId, ac);
    try {
      return await raceAbort(ac.signal, handleNip46Request(acct, 'signEvent', event, origin)) as SignedEvent;
    } finally {
      _nip46Aborts.delete(nip46ReqId);
      await removeNip46InFlight(nip46ReqId);
    }
  }

  // Local signing -- wait for vault unlock if needed
  if (vault.isLocked()) {
    await waitForVaultUnlock(origin, 'signEvent', accountId);
  }

  if (vault.isLocked()) throw new Error('Vault is locked');

  const privkey = vault.getPrivkey(accountId ?? undefined);
  if (!privkey) throw new Error('No private key for active account');

  try {
    return await cryptoSignEvent(event, privkey);
  } finally {
    privkey.fill(0);
  }
}

/**
 * Shared handler for NIP-04/NIP-44 encrypt/decrypt requests.
 * All four operations follow the same flow: permission check → NIP-46 routing → local crypto.
 */
async function handleCryptoRequest(
  method: 'nip04Encrypt' | 'nip04Decrypt' | 'nip44Encrypt' | 'nip44Decrypt',
  theirPubkey: string,
  payload: string,
  origin: string,
  nip46Data: Record<string, string>,
  cryptoFn: (payload: string, privkey: Uint8Array, theirPubkeyBytes: Uint8Array) => Promise<string>,
  denyMessage: string,
  /**
   * Message to reject a NIP-46 account with instead of delegating to the bunker.
   *
   * Post-quantum passes this, and must. A bunker knows nothing about our envelope and
   * answers `nip44Encrypt` with ordinary NIP-44 ciphertext, so without this the caller
   * would receive classic ciphertext in response to a post-quantum request with no way
   * to tell the difference. That silent downgrade is the exact failure the opt-in and
   * the `schemes` marker exist to prevent, and it cannot be caught in `cryptoFn`, which
   * a remote-signer account never reaches. See `nips/04-nip07-encryption-capability.md`.
   *
   * Checked after the permission gate, so an origin cannot probe the active account's
   * type without first being allowed to make the call at all.
   */
  remoteSignerUnsupported?: string,
): Promise<string> {
  const { accountId, accountType } = await getActiveAccountInfo();

  if (!(await vault.exists()) && accountType !== 'nip46') throw new Error('No signing key available');

  // Local permissions apply to ALL account types: an explicit per-origin 'deny'
  // blocks even NIP-46 accounts before anything reaches the remote signer.
  const decision = await permissions.check(origin, method, undefined, accountId ?? undefined);
  if (decision === 'deny') throw new Error('Permission denied');

  // NIP-46 accounts skip the local 'ask' prompt — the bunker runs its own approval.
  if (accountType !== 'nip46' && decision === 'ask') {
    const pubkey = await getActivePublicKey();
    const approved = await queueRequest({
      type: method,
      origin,
      theirPubkey,
      pubkey: pubkey ?? undefined,
      permKey: permissions.permissionKey(method),
      needsPermission: true,
      accountId,
    });
    if (!approved.allow) throw new Error(denyMessage);
  }

  if (accountType === 'nip46') {
    if (remoteSignerUnsupported) throw new Error(remoteSignerUnsupported);
    if (vault.isLocked()) {
      await waitForVaultUnlock(origin, method, accountId);
    }
    if (vault.isLocked()) throw new Error('Vault is locked');
    const acct = vault.getAccountById(accountId!);
    if (!acct || acct.type !== 'nip46') throw new Error('No NIP-46 account active');
    const nip46ReqId = await queueNip46InFlight({ type: method, origin, accountId });
    const ac = new AbortController();
    _nip46Aborts.set(nip46ReqId, ac);
    try {
      return await raceAbort(ac.signal, handleNip46Request(acct, method, nip46Data, origin)) as string;
    } finally {
      _nip46Aborts.delete(nip46ReqId);
      await removeNip46InFlight(nip46ReqId);
    }
  }

  if (vault.isLocked()) {
    await waitForVaultUnlock(origin, method, accountId);
  }
  if (vault.isLocked()) throw new Error('Vault is locked');

  const privkey = vault.getPrivkey(accountId ?? undefined);
  if (!privkey) throw new Error('No private key for active account');
  try {
    return await cryptoFn(payload, privkey, hexToBytes(theirPubkey));
  } finally {
    privkey.fill(0);
  }
}

export async function handleNip04Encrypt(theirPubkey: string, plaintext: string, origin: string): Promise<string> {
  return handleCryptoRequest('nip04Encrypt', theirPubkey, plaintext, origin,
    { pubkey: theirPubkey, plaintext }, nip04Encrypt, 'User denied encryption');
}

export async function handleNip04Decrypt(theirPubkey: string, ciphertext: string, origin: string): Promise<string> {
  return handleCryptoRequest('nip04Decrypt', theirPubkey, ciphertext, origin,
    { pubkey: theirPubkey, ciphertext }, nip04Decrypt, 'User denied decryption');
}

/** Post-quantum options a caller may pass to nip44Encrypt. */
export interface PqEncryptOptions {
  scheme: 'pq';
  /** Recipient's ML-KEM-1024 key, base64, from their kind:10203 attestation. */
  recipientKemKey: string;
}

/**
 * Derive this account's post-quantum keys from the mnemonic held in the vault.
 *
 * Nothing is stored: the keys are a deterministic function of the seed, so they are
 * recomputed per request rather than persisted. Only 24-word accounts qualify — a
 * 12-word seed carries 128 bits, which would make the seed the limiting factor.
 *
 * The four refusals below carry distinct messages on purpose. `window.nostr.nip44.schemes`
 * advertises what this signer accepts, not what the selected account can do, so a caller
 * that correctly detected `pq` support can still land here — and the only way it can tell
 * the user what to change is if we say which of the four it hit. See
 * `nips/04-nip07-encryption-capability.md`.
 *
 * These strings reach the page, so they disclose the shape of the active account. That is
 * a deliberate and narrow trade: it happens only after the user has approved an encryption
 * request from a connected site, never during the pre-consent capability check, which is
 * exactly why `schemes` is a fixed signer-level array and not derived from the account.
 */
async function activePqKeys() {
  if (vault.isLocked()) throw new Error('Vault is locked');
  const payload = vault.getDecryptedPayload();
  const activeId = (await browser.storage.local.get(['activeAccountId']) as Record<string, string>).activeAccountId;
  const acct = payload.accounts.find(a => a.id === activeId);
  if (!acct) throw new Error('No active account');
  if (acct.readOnly || acct.type === 'npub') {
    throw new Error('This account is watch-only, so it cannot use post-quantum keys');
  }
  // NIP-46 is not checked here: those accounts never reach this function, because
  // handleCryptoRequest refuses them at the routing step via `remoteSignerUnsupported`.
  if (!acct.mnemonic) throw new Error('This account has no seed phrase, so it cannot use post-quantum keys');
  if (acct.mnemonic.trim().split(/\s+/).length !== 24) {
    throw new Error('Post-quantum keys require a 24-word seed phrase');
  }
  const seed = await mnemonicToSeed(acct.mnemonic);
  try {
    return { keys: derivePqKeys(seed, acct.derivationIndex ?? 0), pubkey: acct.pubkey };
  } finally {
    seed.fill(0);
  }
}

/**
 * Encrypt with NIP-44, or post-quantum when the caller explicitly asks for it.
 *
 * The post-quantum path is opt-in rather than inferred, deliberately. Inferring would
 * mean this signer fetching the recipient's attestation from relays mid-call — network
 * I/O inside a signing operation — and then deciding what to do when the lookup fails.
 * The only options there are to break every existing caller or to fall back to classic
 * silently, and a silent downgrade is exactly the failure this whole scheme exists to
 * prevent. The calling application owns that decision, so it passes the key it already
 * has.
 */
export async function handleNip44Encrypt(
  theirPubkey: string,
  plaintext: string,
  origin: string,
  opts?: PqEncryptOptions,
): Promise<string> {
  if (opts?.scheme !== 'pq') {
    return handleCryptoRequest('nip44Encrypt', theirPubkey, plaintext, origin,
      { pubkey: theirPubkey, plaintext }, nip44Encrypt, 'User denied encryption');
  }

  return handleCryptoRequest(
    'nip44Encrypt', theirPubkey, plaintext, origin,
    { pubkey: theirPubkey, plaintext },
    async (payload, privkey, theirPubkeyBytes) => {
      const { keys, pubkey } = await activePqKeys();
      try {
        const kem = base64ToArray(opts.recipientKemKey);
        const conv = getConversationKey(privkey, theirPubkeyBytes);
        return pqEncrypt(payload, kem, conv, pubkey, theirPubkey);
      } finally {
        keys.kem.secretKey.fill(0);
        keys.dsa.secretKey.fill(0);
      }
    },
    'User denied encryption',
    'Remote signers do not support post-quantum encryption',
  );
}

/**
 * Decrypt with NIP-44, or post-quantum when the payload says so.
 *
 * This direction needs no flag and takes none. Our envelope is self-describing — a
 * version byte and an algorithm byte — so the payload itself determines the route.
 * A caller cannot get it wrong, and existing clients keep working untouched.
 */
export async function handleNip44Decrypt(theirPubkey: string, ciphertext: string, origin: string): Promise<string> {
  if (!isPqEnvelope(ciphertext)) {
    return handleCryptoRequest('nip44Decrypt', theirPubkey, ciphertext, origin,
      { pubkey: theirPubkey, ciphertext }, nip44Decrypt, 'User denied decryption');
  }

  return handleCryptoRequest(
    'nip44Decrypt', theirPubkey, ciphertext, origin,
    { pubkey: theirPubkey, ciphertext },
    async (payload, privkey, theirPubkeyBytes) => {
      const { keys, pubkey } = await activePqKeys();
      try {
        const conv = getConversationKey(privkey, theirPubkeyBytes);
        return pqDecrypt(payload, keys.kem.secretKey, conv, theirPubkey, pubkey);
      } finally {
        keys.kem.secretKey.fill(0);
        keys.dsa.secretKey.fill(0);
      }
    },
    'User denied decryption',
    'Remote signers cannot read post-quantum messages',
  );
}

// -- NIP-46 Remote Signer (nostr-tools BunkerSigner) --

async function getNip46Client(acct: SafeAccount): Promise<BunkerSigner> {
  if (_nip46Clients.has(acct.id)) {
    return _nip46Clients.get(acct.id)!;
  }

  if (!acct.nip46Config) throw new Error('No NIP-46 config');

  // Parse bunker URL to get { pubkey, relays, secret }
  const bp = await parseBunkerInput(acct.nip46Config.bunkerUrl);
  if (!bp) throw new Error('Failed to parse bunker URL');

  // Restore persisted keypair or generate a new one
  let secretKey: Uint8Array;
  if (acct.nip46Config.localPrivkey) {
    secretKey = hexToBytes(acct.nip46Config.localPrivkey);
  } else {
    secretKey = randomBytes(32);
    // Persist the new keypair for reconnection after service worker restart
    const pubkey = bytesToHex(getPublicKey(secretKey));
    const privkeyHex = bytesToHex(secretKey);
    try {
      await vault.updateAccountNip46Keys(acct.id, privkeyHex, pubkey);
    } catch (e) {
      console.warn('[NIP-46] failed to persist keypair:', (e as Error).message);
    }
  }

  // Create BunkerSigner with auth_url handler (critical for nsec.app)
  const signer = BunkerSigner.fromBunker(secretKey, bp, {
    onauth(url: string) {
      // E2: Only allow https:// auth URLs to prevent javascript:/data: injection
      if (!url.startsWith('https://')) {
        console.warn('[NIP-46] rejected non-HTTPS auth_url:', url);
        return;
      }
      console.debug('[NIP-46] auth_url received, opening:', url);
      browser.tabs.create({ url });
    }
  });

  // Send "connect" RPC to establish session
  await signer.connect();

  _nip46Clients.set(acct.id, signer);
  return signer;
}

/**
 * Forward a signing/crypto request to the remote NIP-46 signer.
 * NIP-46 ephemeral keys live in memory for the session lifetime (held by BunkerSigner).
 */
async function handleNip46Request(acct: SafeAccount, method: string, data: unknown, _origin: string): Promise<SignedEvent | string> {
  const signer = await getNip46Client(acct);

  switch (method) {
    case 'signEvent':
      return signer.signEvent(data as UnsignedEvent);
    case 'nip04Encrypt': {
      const { pubkey, plaintext } = data as { pubkey: string; plaintext: string };
      return signer.nip04Encrypt(pubkey, plaintext);
    }
    case 'nip04Decrypt': {
      const { pubkey, ciphertext } = data as { pubkey: string; ciphertext: string };
      return signer.nip04Decrypt(pubkey, ciphertext);
    }
    case 'nip44Encrypt': {
      const { pubkey, plaintext } = data as { pubkey: string; plaintext: string };
      return signer.nip44Encrypt(pubkey, plaintext);
    }
    case 'nip44Decrypt': {
      const { pubkey, ciphertext } = data as { pubkey: string; ciphertext: string };
      return signer.nip44Decrypt(pubkey, ciphertext);
    }
    default:
      throw new Error(`Unsupported NIP-46 method: ${method}`);
  }
}

/**
 * Check if a NIP-46 client is currently connected
 */
export function isNip46Connected(accountId: string): boolean {
  return _nip46Clients.has(accountId);
}

/**
 * Disconnect and remove a NIP-46 client
 */
export function disconnectNip46(accountId: string): void {
  const client = _nip46Clients.get(accountId);
  if (client) {
    client.close().catch(() => {});
    _nip46Clients.delete(accountId);
  }
}
