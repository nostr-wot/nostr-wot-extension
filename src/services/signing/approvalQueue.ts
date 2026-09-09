import * as vault from '../vault/vault.ts';
import browser from '@lib/browser.ts';
import type { RequestDecision, PendingRequest } from '@domain/signing/types.ts';
import type { UnsignedEvent, SignedEvent } from '@domain/nostr/types.ts';
import type { SafeAccount } from '@domain/accounts/types.ts';
import { requestMatchesAccount } from '@domain/permissions/approval.ts';
import { openPopupForActiveTab } from '../browser/openPopupForActiveTab.ts';
import { AsyncLock } from '@utils/asyncLock.ts';
import { SIGNER_REQUEST_TIMEOUT_MS, MAX_PENDING_PER_ORIGIN } from '@constants/signing.ts';
import { VAULT_POLL_INTERVAL_MS } from '@constants/vault.ts';
import { getActiveAccountInfo, getActivePublicKey, clearGetPubkeyCooldown } from './identity.ts';
import { handleNip46Request } from './remoteSigner.ts';

// In-memory resolvers for pending requests (keyed by request ID)
const _pendingResolvers: Map<string, (decision: RequestDecision) => void> = new Map();

let _requestCounter: number = 0;

const _timeoutTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

// Vault unlock waiters -- independent of _pendingResolvers for resilience
const _unlockWaiters: Map<string, { resolve: () => void; reject: (err: Error) => void }> = new Map();

// Shared async lock for session storage writes
const _lock = new AsyncLock();

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
  const {accountId: activeAccountId} = await getActiveAccountInfo();
  const entry: PendingRequest = { id, ...request, accountId: request.accountId ?? activeAccountId ?? vault.getActiveAccountId(), timestamp: Date.now() };

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
      void removePendingFromStorage(id);
      reject(new Error('Request timed out'));
    }, SIGNER_REQUEST_TIMEOUT_MS);
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
export async function resolveRequest(id: string, decision: RequestDecision): Promise<void> {
  if (decision.allow) {
    const request = (await getPending()).find(request => request.id === id);
    const {accountId} = await getActiveAccountInfo();
    const idNow = accountId ?? vault.getActiveAccountId();
    const pubkey = await getActivePublicKey();
    if (!request || !requestMatchesAccount(request, idNow && pubkey ? {id:idNow,pubkey} : null)) decision = {allow:false,remember:false,reason:'Account switched'};
  }
  const resolver = _pendingResolvers.get(id);
  if (resolver) {
    resolver(decision);
    _pendingResolvers.delete(id);
  }
  const timer = _timeoutTimers.get(id);
  if (timer) { clearTimeout(timer); _timeoutTimers.delete(id); }
  // Returned rather than fired and forgotten: the popup refreshes as soon as
  // `signer_resolve` replies, and if the removal is still in flight at that
  // point it reads the request back and repaints a card it just approved.
  return removePendingFromStorage(id);
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
    const {accountId} = await getActiveAccountInfo();
    const idNow = accountId ?? vault.getActiveAccountId();
    const pubkey = await getActivePublicKey();
    const account = idNow && pubkey ? {id:idNow,pubkey} : null;
    for (const req of matching) {
      const resolver = _pendingResolvers.get(req.id);
      if (resolver) {
        resolver(decision.allow && !requestMatchesAccount(req, account) ? {allow:false,remember:false,reason:'Account switched'} : decision);
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
  clearGetPubkeyCooldown();
  await _lock.run(async () => {
    await browser.storage.session.set({ signerPending: [] });
    await updateBadge(0);
  });
  // Every other mutation of `signerPending` broadcasts; this one did not, and it
  // is the one that empties the queue. A popup open across a worker restart —
  // which its own RPC can trigger, since the keep-alive alarm is armed only for
  // an unlocked timed-lock vault — kept rendering the approvals this just
  // deleted, and Approve on one of them returned { ok: true } against nothing.
  browser.runtime.sendMessage({ type: 'signerPendingUpdated' }).catch(() => {});
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
  clearGetPubkeyCooldown();
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
export async function waitForVaultUnlock(origin: string, type: string, accountId: string | null): Promise<void> {
  if (!vault.isLocked()) return;

  // A service-worker cold start in "Never lock" mode unlocks the vault
  // asynchronously (PBKDF2, 210k iterations). Requests that arrive inside that
  // window are not waiting on the user at all — popping the popup open for them
  // showed an empty popup on every already-approved request. Wait the auto-unlock
  // out first; only a vault that is still locked afterwards needs the user.
  await vault.whenStartupUnlockSettled();
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
      }, SIGNER_REQUEST_TIMEOUT_MS);
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
/** Track and cancel remote work without exposing the abort registry. */
export async function runNip46Request(acct: SafeAccount, method: string, data: unknown, origin: string): Promise<SignedEvent | string> {
  const id = await queueNip46InFlight({ type: method, origin, accountId: acct.id });
  const ac = new AbortController();
  _nip46Aborts.set(id, ac);
  try { return await raceAbort(ac.signal, handleNip46Request(acct, method, data, origin)); }
  finally { _nip46Aborts.delete(id); await removeNip46InFlight(id); }
}
