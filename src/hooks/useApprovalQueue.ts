import { useState, useEffect, useCallback, useRef } from 'react';
import browser from '@lib/browser.ts';
import { rpc } from '@services/rpc.ts';
import { useAccount } from '@context/AccountContext';
import {
  requestMatchesAccount,
  partitionPending,
  groupApprovals,
  currentApprovalGroup,
  groupNip46,
  liveIds,
  isRequestLive,
  type PendingRequest,
  type ApprovalGroup,
} from '@domain/permissions/approval.ts';
import { useVault } from '@context/VaultContext';

interface UseApprovalQueueOptions {
  onRequestUnlock?: () => void;
  onUnlockWaitersChange?: (waiters: PendingRequest[]) => void;
}

/**
 * The pending signing queue: what to show, and keeping it current.
 *
 * Lifted out of ApprovalOverlay so the component is render plus actions. The
 * ref discipline below is the load-bearing part and its comments move with it —
 * every one records a loop or a lost broadcast that actually happened.
 *
 * What it deliberately does NOT own: the decisions. Those are pure functions in
 * `src/shared/approval.ts`, where they are tested — including the fail-closed
 * account filter. Origins stay visible on every request.
 */
export default function useApprovalQueue({ onRequestUnlock, onUnlockWaitersChange }: UseApprovalQueueOptions) {
  const [groups, setGroups] = useState<ApprovalGroup[]>([]);
  const [nip46Groups, setNip46Groups] = useState<ApprovalGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ApprovalGroup | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<PendingRequest | null>(null);
  const [selectedNip46, setSelectedNip46] = useState<ApprovalGroup | null>(null);
  const vault = useVault();
  const { active } = useAccount();
  const activeRef = useRef(active);
  activeRef.current = active;

  // Held in refs so `refresh` does not depend on their identity. PopupApp passes
  // `onRequestUnlock` as an inline arrow, so it was a new function on every
  // parent render; that made a new `refresh`, which re-ran the effect below,
  // which called `refresh`, which pushed a fresh array into the parent's state
  // and re-rendered it. The popup sat in that circle for as long as it was open,
  // re-querying the active tab and the pending queue the whole time, and tearing
  // the runtime listener down and back up between laps — which can lose a
  // `signerPendingUpdated` broadcast that lands in the gap.
  const onRequestUnlockRef = useRef(onRequestUnlock);
  onRequestUnlockRef.current = onRequestUnlock;
  const onUnlockWaitersChangeRef = useRef(onUnlockWaitersChange);
  onUnlockWaitersChangeRef.current = onUnlockWaitersChange;
  // What we last told the parent, so an unchanged list does not re-render it.
  const lastWaiterKeyRef = useRef<string | null>(null);
  // `vault.locked` is read inside refresh but must not key it: as a dependency it
  // rebuilt refresh on the very transition that matters, re-running the effect and
  // leaving a gap where the runtime listener is detached — exactly when the unlock
  // that just happened is broadcasting.
  const vaultLockedRef = useRef(vault.locked);
  vaultLockedRef.current = vault.locked;

  // Which run of refresh is current. Approving a group of N fires N+1 overlapping
  // refreshes, and the background's removal is not instantaneous, so without this
  // the slowest run wins by finishing last and repaints requests that were just
  // resolved — as approvable cards. This is the rule docs/component-standards.md
  // §9 states; the function that motivated writing it down was not given it.
  const runRef = useRef(0);
  const refresh = useCallback(async () => {
    const run = ++runRef.current;
    const account = activeRef.current;
    if (!account) return;
    const current = () => run === runRef.current && activeRef.current?.id === account.id;

    const pending: PendingRequest[] = await rpc('signer_getPending') || [];
    if (!current()) return;

    const filtered = pending.filter(request => requestMatchesAccount(request, account));
    const rejected = pending.filter(request => !requestMatchesAccount(request, account));
    await Promise.all(rejected.map(request => rpc(request.nip46InFlight ? 'signer_cancelNip46' : request.waitingForUnlock ? 'signer_cancelUnlockWaiter' : 'signer_resolve', {id:request.id,decision:{allow:false,remember:false,reason:'Account switched'}})));
    if (!current()) return;
    const { actionable, nip46InFlight, unlockWaiters } = partitionPending(filtered);

    // Only tell the parent when the set actually changed. The array is rebuilt
    // on every refresh, and handing it over unconditionally re-rendered PopupApp
    // for a list identical to the one it already had.
    const waiterKey = unlockWaiters.map((r) => r.id).join(',');
    if (waiterKey !== lastWaiterKeyRef.current) {
      lastWaiterKeyRef.current = waiterKey;
      onUnlockWaitersChangeRef.current?.(unlockWaiters);
    }
    if (unlockWaiters.length > 0 && vaultLockedRef.current) {
      onRequestUnlockRef.current?.();
    }

    if (!current()) return;
    const nextGroups = groupApprovals(actionable);
    setGroups(nextGroups);
    const nextNip46Groups = groupNip46(nip46InFlight);
    setNip46Groups(nextNip46Groups);

    // A detail modal holds a snapshot taken when it opened. The request behind it
    // can be gone by now — timed out, resolved from another surface, or dropped
    // when the worker restarted — and nothing was reconciling that, so the modal
    // outlived its request and Approve acknowledged an id the background no
    // longer had, then closed as though it had signed.
    const live = liveIds(filtered);
    setSelectedRequest((sel) => (isRequestLive(sel, live) ? sel : null));
    setSelectedGroup((sel) => currentApprovalGroup(sel, nextGroups));
    setSelectedNip46((sel) => currentApprovalGroup(sel, nextNip46Groups));
  }, []);

  useEffect(() => {
    void refresh();

    const listener = (message: any) => {
      if (message.type === 'signerPendingUpdated') void refresh();
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  useEffect(() => { void refresh(); }, [active?.id, refresh]);

  // The vault unlocking is a transition the pending queue's own broadcasts do not
  // cover: nothing about `signerPending` changed, but what the popup should show
  // for it did. Refresh on the flip without making it a dependency of `refresh`.
  useEffect(() => {
    if (!vault.locked) void refresh();
  }, [vault.locked, refresh]);

  const closeAndRefresh = () => {
    setSelectedGroup(null);
    setSelectedRequest(null);
    setSelectedNip46(null);
    void refresh();
  };

  /**
   * Every action on this surface runs through here.
   *
   * None of them had a catch. A failing RPC — the worker asleep past its three
   * wake retries, a storage write refused — rejected somewhere inside the loop,
   * so the remaining requests stayed pending, the overlay never closed or
   * refreshed, and the user was told nothing at all. On a surface whose whole
   * job is releasing the user's signing key, silence is the wrong failure mode.
   *
   * The refresh runs either way: after a partial failure the queue on screen
   * must match the queue in the background, whatever is left in it.
   */

  return {
    groups,
    nip46Groups,
    selectedGroup, setSelectedGroup,
    selectedRequest, setSelectedRequest,
    selectedNip46, setSelectedNip46,
    refresh,
    closeAndRefresh,
  };
}
