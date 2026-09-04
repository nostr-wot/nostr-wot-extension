import React, { useState } from 'react';
import browser from '@shared/browser.ts';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { resolveActiveTabDomain } from '@shared/activeTabDomain.ts';
import {
  filterPendingForDomain,
  partitionPending,
  groupApprovals,
  groupNip46,
  asGroup,
  liveIds,
  isRequestLive,
  isGroupLive,
  type PendingRequest,
  type ApprovalGroup,
} from '@shared/approval.ts';
import ApprovalCard from './ApprovalCard';
import useApprovalQueue from '@hooks/useApprovalQueue.ts';
import EventDetailModal from '@components/EventDetailModal/EventDetailModal';
import { usePermissions } from '@popup/context/PermissionsContext';
import { useAccount } from '@popup/context/AccountContext';
import styles from './ApprovalOverlay.module.css';
import Button from '@components/Button/Button';

interface ApprovalOverlayProps {
  onRequestUnlock?: () => void;
  onUnlockWaitersChange?: (waiters: PendingRequest[]) => void;
}

export default function ApprovalOverlay({ onRequestUnlock, onUnlockWaitersChange }: ApprovalOverlayProps) {
  const [expanded, setExpanded] = useState(false);
  const [actionError, setActionError] = useState<string>('');
  const permissions = usePermissions();
  const { active, accounts } = useAccount();

  const {
    groups,
    nip46Groups,
    selectedGroup, setSelectedGroup,
    selectedRequest, setSelectedRequest,
    selectedNip46, setSelectedNip46,
    closeAndRefresh,
  } = useApprovalQueue({ onRequestUnlock, onUnlockWaitersChange });

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

  // The expanded view acts on one request; a one-request group makes that the
  // same code path as the grouped actions rather than a second copy of each.
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
      <div className={`${styles.scrim} absolute inset-0 z-sheet bg-[rgba(0,0,0,0.25)]`} />
      <div className={`${styles.overlay} absolute bottom-0 left-0 right-0 z-[calc(var(--z-sheet)+1)] max-h-[85vh] bg-[rgba(255,255,255,0.96)] backdrop-blur-[16px] rounded-t-xl shadow-[0_-4px_24px_rgba(0,0,0,0.12)] flex flex-col p-8`}>
        <div className="flex items-center gap-4 mb-6 flex-wrap">
          <span className="text-lg font-bold text-heading">{t('approval.pendingRequests')}</span>
          <span className="text-md font-bold bg-brand text-on-brand py-1.5 px-5 rounded-lg min-w-12 text-center">{totalCount}</span>
          <div className="ml-auto flex items-center gap-3">
            {allRequests.length > 1 && (
              <Button small outline onClick={() => setExpanded(!expanded)}>
                {expanded ? t('approval.grouped') : t('approval.expanded')}
              </Button>
            )}
            {groups.length > 0 && (
              <Button small outline variant="danger" onClick={handleRejectAll}>
                {t('approval.rejectAll')}
              </Button>
            )}
          </div>
        </div>
        {actionError && (
          <div className="py-3 px-6 text-sm text-error text-center" role="alert">{actionError}</div>
        )}
        {groups.length > 0 && permissions.useGlobalDefaults && accounts && accounts.length > 1 && (
          <div className="pt-2 px-6 pb-4 text-xs text-muted text-center">
            {t('approval.appliesToAllAccounts')}
          </div>
        )}
        <div className="flex-1 overflow-y-auto flex flex-col gap-4">
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
          onApprove={() => handleApprove(asGroup(selectedRequest))}
          onAlwaysAllow={() => handleAlwaysAllow(asGroup(selectedRequest))}
          onDeny={() => handleDeny(asGroup(selectedRequest))}
          onAlwaysDeny={() => handleAlwaysDeny(asGroup(selectedRequest))}
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
