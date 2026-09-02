import React, { useState, useEffect, useCallback, useRef } from 'react';
import browser from '@shared/browser.js';
import { rpc } from '@shared/rpc.js';
import { t } from '@lib/i18n.js';
import { resolveActiveTabDomain } from '@shared/activeTabDomain.ts';
import ApprovalCard from './ApprovalCard';
import EventDetailModal from '@components/EventDetailModal/EventDetailModal';
import { useVault } from '../../context/VaultContext';
import { usePermissions } from '../../context/PermissionsContext';
import { useAccount } from '../../context/AccountContext';
import styles from './ApprovalOverlay.module.css';

interface ApprovalOverlayProps {
  onRequestUnlock?: () => void;
  onUnlockWaitersChange?: (waiters: PendingRequest[]) => void;
}

interface PendingRequest {
  id: string;
  origin: string;
  type: string;
  permKey?: string;
  needsPermission?: boolean;
  nip46InFlight?: boolean;
  waitingForUnlock?: boolean;
  accountId?: string;
  event?: any;
  [key: string]: any;
}

interface ApprovalGroup {
  origin: string;
  method: string;
  permKey: string;
  nip46InFlight?: boolean;
  requests: PendingRequest[];
}

export default function ApprovalOverlay({ onRequestUnlock, onUnlockWaitersChange }: ApprovalOverlayProps) {
  const [groups, setGroups] = useState<ApprovalGroup[]>([]);
  const [nip46Groups, setNip46Groups] = useState<ApprovalGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ApprovalGroup | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<PendingRequest | null>(null);
  const [selectedNip46, setSelectedNip46] = useState<ApprovalGroup | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [actionError, setActionError] = useState<string>('');
  const vault = useVault();
  const permissions = usePermissions();
  const { active, accounts } = useAccount();

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
  // The tab the popup belongs to cannot change while the popup is alive, so the
  // domain is resolved once and reused.
  const domainRef = useRef<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    const run = ++runRef.current;
    const current = () => run === runRef.current;

    if (domainRef.current === undefined) {
      const { domain } = await resolveActiveTabDomain();
      if (!current()) return;
      domainRef.current = domain;
    }
    const currentDomain = domainRef.current;

    const pending: PendingRequest[] = await rpc('signer_getPending') || [];
    if (!current()) return;

    // Fail closed. Falling back to "show everything" when the site could not be identified
    // meant one site's popup listed another site's pending signing requests — origin,
    // event kind and full content included. Showing nothing is safe: the pending queue is
    // cleared whenever the service worker restarts, so a tab with no known origin has no
    // requests of its own to approve anyway.
    const filtered = currentDomain
      ? pending.filter((r) => r.origin === currentDomain)
      : [];

    const actionable = filtered.filter((r) => r.needsPermission && !r.nip46InFlight);
    const nip46InFlight = filtered.filter((r) => r.nip46InFlight);
    const unlockWaiters = filtered.filter((r) => r.waitingForUnlock);

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

    // Group actionable requests
    const groupMap = new Map<string, ApprovalGroup>();
    for (const req of actionable) {
      const groupKey = req.permKey || req.type;
      const key = `${req.origin}::${groupKey}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          origin: req.origin,
          method: req.type,
          permKey: groupKey,
          requests: [],
        });
      }
      groupMap.get(key)!.requests.push(req);
    }

    // Group NIP-46 in-flight requests
    const nip46Map = new Map<string, ApprovalGroup>();
    for (const req of nip46InFlight) {
      const key = `${req.origin}::${req.type}`;
      if (!nip46Map.has(key)) {
        nip46Map.set(key, {
          origin: req.origin,
          method: req.type,
          permKey: req.type,
          nip46InFlight: true,
          requests: [],
        });
      }
      nip46Map.get(key)!.requests.push(req);
    }

    if (!current()) return;
    setGroups([...groupMap.values()]);
    setNip46Groups([...nip46Map.values()]);

    // A detail modal holds a snapshot taken when it opened. The request behind it
    // can be gone by now — timed out, resolved from another surface, or dropped
    // when the worker restarted — and nothing was reconciling that, so the modal
    // outlived its request and Approve acknowledged an id the background no
    // longer had, then closed as though it had signed.
    const live = new Set(pending.map((r) => r.id));
    setSelectedRequest((sel) => (sel && !live.has(sel.id) ? null : sel));
    setSelectedGroup((sel) =>
      sel && !sel.requests.some((r) => live.has(r.id)) ? null : sel);
    setSelectedNip46((sel) =>
      sel && !sel.requests.some((r) => live.has(r.id)) ? null : sel);
  }, []);

  useEffect(() => {
    refresh();

    const listener = (message: any) => {
      if (message.type === 'signerPendingUpdated') refresh();
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  // The vault unlocking is a transition the pending queue's own broadcasts do not
  // cover: nothing about `signerPending` changed, but what the popup should show
  // for it did. Refresh on the flip without making it a dependency of `refresh`.
  useEffect(() => {
    if (!vault.locked) refresh();
  }, [vault.locked, refresh]);

  const closeAndRefresh = () => {
    setSelectedGroup(null);
    setSelectedRequest(null);
    setSelectedNip46(null);
    refresh();
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
  const runAction = async (action: () => Promise<void>) => {
    setActionError('');
    try {
      await action();
    } catch {
      setActionError(t('approval.actionFailed'));
    } finally {
      closeAndRefresh();
    }
  };

  // --- Group actions ---

  const handleApprove = (group: ApprovalGroup) => runAction(async () => {
    for (const req of group.requests) {
      await rpc('signer_resolve', { id: req.id, decision: { allow: true, remember: false } });
    }
  });

  // Resolve first, then remember. The old order granted a standing permission
  // and only then tried to resolve the queue, so a failure between the two left
  // the site permanently allowed with its requests still hanging — the worst of
  // both outcomes. This way a failure costs the user one more prompt, nothing more.
  const handleAlwaysAllow = (group: ApprovalGroup) => runAction(async () => {
    const accountId = group.requests[0]?.accountId || active?.id || null;
    await rpc('signer_resolveBatch', {
      origin: group.origin,
      permKey: group.permKey,
      decision: { allow: true, remember: false },
    });
    await permissions.savePermission(group.origin, group.permKey, 'allow', accountId);
  });

  const handleDeny = (group: ApprovalGroup) => runAction(async () => {
    for (const req of group.requests) {
      await rpc('signer_resolve', { id: req.id, decision: { allow: false, remember: false } });
    }
  });

  const handleAlwaysDeny = (group: ApprovalGroup) => runAction(async () => {
    const accountId = group.requests[0]?.accountId || active?.id || null;
    await rpc('signer_resolveBatch', {
      origin: group.origin,
      permKey: group.permKey,
      decision: { allow: false, remember: false },
    });
    await permissions.savePermission(group.origin, group.permKey, 'deny', accountId);
  });

  // --- Single request actions (expanded mode) ---

  const handleApproveSingle = (req: PendingRequest) => runAction(async () => {
    await rpc('signer_resolve', { id: req.id, decision: { allow: true, remember: false } });
  });

  const handleDenySingle = (req: PendingRequest) => runAction(async () => {
    await rpc('signer_resolve', { id: req.id, decision: { allow: false, remember: false } });
  });

  const handleAlwaysAllowSingle = (req: PendingRequest) => runAction(async () => {
    const accountId = req.accountId || active?.id || null;
    const permKey = req.permKey || req.type;
    await rpc('signer_resolveBatch', {
      origin: req.origin,
      permKey,
      decision: { allow: true, remember: false },
    });
    await permissions.savePermission(req.origin, permKey, 'allow', accountId);
  });

  const handleAlwaysDenySingle = (req: PendingRequest) => runAction(async () => {
    const accountId = req.accountId || active?.id || null;
    const permKey = req.permKey || req.type;
    await rpc('signer_resolveBatch', {
      origin: req.origin,
      permKey,
      decision: { allow: false, remember: false },
    });
    await permissions.savePermission(req.origin, permKey, 'deny', accountId);
  });

  // --- Reject all ---

  const handleRejectAll = () => runAction(async () => {
    for (const group of groups) {
      for (const req of group.requests) {
        await rpc('signer_resolve', { id: req.id, decision: { allow: false, remember: false } });
      }
    }
  });

  // All individual requests for expanded view
  const allRequests = groups.flatMap((g) => g.requests);

  if (groups.length === 0 && nip46Groups.length === 0) return null;

  const totalCount = groups.reduce((n, g) => n + g.requests.length, 0) + nip46Groups.reduce((n, g) => n + g.requests.length, 0);

  return (
    <>
      <div className={styles.scrim} />
      <div className={styles.overlay}>
        <div className={styles.header}>
          <span className={styles.title}>{t('approval.pendingRequests')}</span>
          <span className={styles.count}>{totalCount}</span>
          <div className={styles.headerActions}>
            {allRequests.length > 1 && (
              <button className={styles.toggleBtn} onClick={() => setExpanded(!expanded)}>
                {expanded ? t('approval.grouped') : t('approval.expanded')}
              </button>
            )}
            {groups.length > 0 && (
              <button className={styles.rejectAllBtn} onClick={handleRejectAll}>
                {t('approval.rejectAll')}
              </button>
            )}
          </div>
        </div>
        {actionError && (
          <div className={styles.actionError} role="alert">{actionError}</div>
        )}
        {groups.length > 0 && permissions.useGlobalDefaults && accounts && accounts.length > 1 && (
          <div className={styles.legend}>
            {t('approval.appliesToAllAccounts')}
          </div>
        )}
        <div className={styles.list}>
          {expanded ? (
            allRequests.map((req) => (
              <ApprovalCard
                key={req.id}
                group={{ origin: req.origin, method: req.type, permKey: req.permKey || req.type, requests: [req] }}
                onClick={() => setSelectedRequest(req)}
              />
            ))
          ) : (
            groups.map((group) => (
              <ApprovalCard
                key={`${group.origin}::${group.permKey}`}
                group={group}
                onClick={() => setSelectedGroup(group)}
              />
            ))
          )}
          {nip46Groups.map((group) => (
            <ApprovalCard
              key={`nip46::${group.origin}::${group.method}`}
              group={group}
              // Through runAction like every other action here. These two were
              // the only paths still bypassing it — on the request type whose
              // characteristic failure is "the remote signer never answers",
              // where a silent cancel is exactly what the user cannot afford.
              onCancel={() => runAction(async () => {
                for (const req of group.requests) {
                  await rpc('signer_cancelNip46', { id: req.id });
                }
              })}
              onClick={() => setSelectedNip46(group)}
            />
          ))}
        </div>
      </div>

      {selectedGroup && (
        <EventDetailModal
          request={selectedGroup.requests[0]}
          onApprove={() => handleApprove(selectedGroup)}
          onAlwaysAllow={() => handleAlwaysAllow(selectedGroup)}
          onDeny={() => handleDeny(selectedGroup)}
          onAlwaysDeny={() => handleAlwaysDeny(selectedGroup)}
          onClose={() => setSelectedGroup(null)}
          zIndex={510}
        />
      )}

      {selectedRequest && (
        <EventDetailModal
          request={selectedRequest}
          onApprove={() => handleApproveSingle(selectedRequest)}
          onAlwaysAllow={() => handleAlwaysAllowSingle(selectedRequest)}
          onDeny={() => handleDenySingle(selectedRequest)}
          onAlwaysDeny={() => handleAlwaysDenySingle(selectedRequest)}
          onClose={() => setSelectedRequest(null)}
          zIndex={510}
        />
      )}

      {selectedNip46 && (
        <EventDetailModal
          request={selectedNip46.requests[0]}
          nip46InFlight
          onDeny={() => runAction(async () => {
            for (const req of selectedNip46.requests) {
              await rpc('signer_cancelNip46', { id: req.id });
            }
          })}
          onClose={() => setSelectedNip46(null)}
          zIndex={510}
        />
      )}
    </>
  );
}
