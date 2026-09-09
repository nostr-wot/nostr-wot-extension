/**
 * Which pending signing requests this popup may show, and how they group.
 *
 * This is the decision half of the approval queue, pulled out of the component
 * so it can be tested. It is the same move `siteState.ts` and `sendTarget.ts`
 * made, and for the same reason — but the stakes are higher here: the first
 * function below is a cross-site isolation boundary, and until it had a home of
 * its own nothing could assert that it holds.
 *
 * `ApprovalGroup` lives here too. It had been hand-copied into both
 * ApprovalOverlay and ApprovalCard, and the copies had already drifted into a
 * type error that the card's own comment documented.
 *
 * `PendingRequest` is NOT redefined here: `domain/signing/types.ts` already owns the
 * canonical shape — the one the background actually queues — and the two UI
 * copies were narrower restatements of it that had to be kept in sync by hand.
 * Re-exporting the real one is the point.
 */

export type { PendingRequest } from '@domain/signing/types.ts';

import type { PendingRequest } from '@domain/signing/types.ts';

export interface ApprovalGroup {
  origin: string;
  method: string;
  permKey: string;
  nip46InFlight?: boolean;
  requests: PendingRequest[];
}

/**
 * Fail closed.
 *
 * Falling back to "show everything" when the site could not be identified meant
 * one site's popup listed another site's pending signing requests — origin,
 * event kind and full content included. Showing nothing is safe: the pending
 * queue is cleared whenever the service worker restarts, so a tab with no known
 * origin has no requests of its own to approve anyway.
 */
export function filterPendingForDomain(
  pending: PendingRequest[],
  domain: string | null | undefined,
): PendingRequest[] {
  if (!domain) return [];
  return pending.filter((r) => r.origin === domain);
}

/**
 * Split the visible requests into the three queues the UI treats differently.
 *
 * A NIP-46 request in flight is never actionable — it is waiting on a remote
 * signer, not on the user — which is why `actionable` excludes it rather than
 * relying on `needsPermission` alone.
 */
export function partitionPending(filtered: PendingRequest[]): {
  actionable: PendingRequest[];
  nip46InFlight: PendingRequest[];
  unlockWaiters: PendingRequest[];
} {
  return {
    actionable: filtered.filter((r) => r.needsPermission && !r.nip46InFlight),
    nip46InFlight: filtered.filter((r) => r.nip46InFlight),
    unlockWaiters: filtered.filter((r) => r.waitingForUnlock),
  };
}

function group(
  requests: PendingRequest[],
  keyOf: (r: PendingRequest) => string,
  extra?: Partial<ApprovalGroup>,
): ApprovalGroup[] {
  const map = new Map<string, ApprovalGroup>();
  for (const req of requests) {
    const groupKey = keyOf(req);
    const key = `${req.accountId || ''}::${req.origin}::${groupKey}`;
    let g = map.get(key);
    if (!g) {
      g = { origin: req.origin, method: req.type, permKey: groupKey, ...extra, requests: [] };
      map.set(key, g);
    }
    g.requests.push(req);
  }
  return [...map.values()];
}

/** Actionable requests, grouped by origin and the permission they need. */
export function groupApprovals(requests: PendingRequest[]): ApprovalGroup[] {
  return group(requests, (r) => r.permKey || r.type);
}

/** In-flight NIP-46 requests, grouped by origin and method. */
export function groupNip46(requests: PendingRequest[]): ApprovalGroup[] {
  return group(requests, (r) => r.type, { nip46InFlight: true });
}

/**
 * Treat one request as a group of one.
 *
 * The expanded view acts on individual requests, and had four handlers that
 * were the group handlers with the loop unrolled — including the same
 * `permKey || type` fallback and the same accountId lookup, written twice. A
 * one-request group makes them the same code path, so approving one request and
 * approving a group of one cannot drift apart.
 */
export function asGroup(req: PendingRequest): ApprovalGroup {
  return {
    origin: req.origin,
    method: req.type,
    permKey: req.permKey || req.type,
    requests: [req],
  };
}

/**
 * Whether a selection taken when a detail view opened still refers to something
 * the background knows about.
 *
 * A detail modal holds a snapshot from when it opened. The request behind it can
 * be gone by now — timed out, resolved from another surface, or dropped when the
 * worker restarted — and nothing was reconciling that, so the modal outlived its
 * request and Approve acknowledged an id the background no longer had, then
 * closed as though it had signed.
 */
export function liveIds(pending: PendingRequest[]): Set<string> {
  return new Set(pending.map((r) => r.id));
}

export function isRequestLive(req: PendingRequest | null, live: Set<string>): boolean {
  return !!req && live.has(req.id);
}

export function isGroupLive(g: ApprovalGroup | null, live: Set<string>): boolean {
  return !!g && g.requests.some((r) => live.has(r.id));
}

/** Author identity is distinct from a message recipient (theirPubkey). */
export function requestMatchesAccount(request: PendingRequest, account: {id:string;pubkey:string} | null): boolean {
  return !!account && request.accountId === account.id
    && (!request.pubkey || request.pubkey === account.pubkey)
    && (!request.event?.pubkey || request.event.pubkey === account.pubkey);
}

/** Resolve only the IDs the user reviewed; later arrivals need their own decision. */
export async function resolveDisplayedRequests(requests: PendingRequest[], resolve: (id:string) => Promise<unknown>): Promise<void> {
  const ids = requests.map(request => request.id);
  const results = await Promise.allSettled(ids.map(resolve));
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

/** Keep an open group attached to its live queue, not its first-click snapshot. */
export function currentApprovalGroup(selection: ApprovalGroup | null, groups: ApprovalGroup[]): ApprovalGroup | null {
  if (!selection) return null;
  return groups.find(group => group.origin === selection.origin
    && group.permKey === selection.permKey
    && group.requests[0]?.accountId === selection.requests[0]?.accountId) ?? null;
}
