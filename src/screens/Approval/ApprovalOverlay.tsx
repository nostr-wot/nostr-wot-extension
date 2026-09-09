import { useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@lib/i18n.js';
import {
  currentApprovalGroup,
  resolveDisplayedRequests,
  type PendingRequest,
  type ApprovalGroup,
} from '@domain/permissions/approval.ts';
import ApprovalCard from './ApprovalCard';
import useApprovalQueue from '@hooks/useApprovalQueue.ts';
import EventDetailModal from '@components/EventDetailModal/EventDetailModal';
import { usePermissions } from '@context/PermissionsContext';
import { useAccount } from '@context/AccountContext';
import Button from '@components/Button/Button';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';
import FormError from '@components/FormError/FormError';

interface ApprovalOverlayProps {
  onRequestUnlock?: () => void;
  onUnlockWaitersChange?: (waiters: PendingRequest[]) => void;
}

export default function ApprovalOverlay({ onRequestUnlock, onUnlockWaitersChange }: ApprovalOverlayProps) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>('');
  const permissions = usePermissions();
  const { active, accounts } = useAccount();

  const {
    groups,
    nip46Groups,
    selectedGroup: groupSelection, setSelectedGroup,
    selectedNip46, setSelectedNip46,
    closeAndRefresh,
  } = useApprovalQueue({ onRequestUnlock, onUnlockWaitersChange });

  const selectedGroup = currentApprovalGroup(groupSelection, groups);

  const runAction = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setActionError('');
    try {
      await action();
    } catch {
      setActionError(t('approval.actionFailed'));
    } finally {
      setBusy(false);
      closeAndRefresh();
    }
  };

  // --- Group actions ---

  const handleApprove = (group: ApprovalGroup) => runAction(async () => {
    await resolveDisplayedRequests(group.requests, id => rpc('signer_resolve', { id, decision: { allow: true, remember: false } }));
  });

  const handleApproveShown = () => runAction(async () => {
    const shown = groups.flatMap(group => group.requests);
    await resolveDisplayedRequests(shown, id => rpc('signer_resolve', {id,decision:{allow:true,remember:false}}));
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
    await resolveDisplayedRequests(group.requests, id => rpc('signer_resolve', { id, decision: { allow: false, remember: false } }));
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

  const handleRejectAll = () => runAction(async () => {
    for (const group of groups) {
      for (const req of group.requests) {
        await rpc('signer_resolve', { id: req.id, decision: { allow: false, remember: false } });
      }
    }
  });

  if (groups.length === 0 && nip46Groups.length === 0) return null;

  const totalCount = groups.reduce((n, g) => n + g.requests.length, 0) + nip46Groups.reduce((n, g) => n + g.requests.length, 0);

  return (
    <>
      <div className={`animate-scrim-fade-in absolute inset-0 z-sheet bg-[rgba(0,0,0,0.25)]`} />
      <Container className="animate-sheet-slide-in absolute bottom-0 left-0 right-0 z-[calc(var(--z-sheet)+1)] max-h-[85vh] bg-elevated backdrop-blur-[16px] rounded-t-xl shadow-[0_-4px_24px_rgba(0,0,0,0.12)] p-8">
        <Container variant="row" gap={4} className="mb-6 flex-wrap">
          {/* Not `Text`: `font-bold` + `text-heading` at `text-lg` is not one
              of the four variants. */}
          <span className="text-lg font-bold text-heading">{t('approval.pendingRequests')}</span>
          <span className="text-md font-bold bg-brand text-on-brand py-1.5 px-5 rounded-lg min-w-12 text-center">{totalCount}</span>
          <Container variant="row" gap={3} className="ml-auto">
            {groups.length > 0 && <Button small disabled={busy} onClick={handleApproveShown}>{t('approval.approveShown')}</Button>}
            {groups.length > 0 && (
              <Button small outline variant="danger" disabled={busy} onClick={handleRejectAll}>
                {t('approval.rejectAll')}
              </Button>
            )}
          </Container>
        </Container>
        <FormError className="py-3 px-6 text-center">{actionError}</FormError>
        {groups.length > 0 && permissions.useGlobalDefaults && accounts && accounts.length > 1 && (
          <Text variant="muted" as="div" className="pt-2 px-6 pb-4 text-center">
            {t('approval.appliesToAllAccounts')}
          </Text>
        )}
        <Container gap={4} className="flex-1 min-h-0 overflow-y-auto">
          {groups.map((group) => (
            <ApprovalCard
              key={`${group.origin}::${group.permKey}`}
              group={group}
              onClick={() => setSelectedGroup(group)}
            />
          ))}
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
        </Container>
      </Container>

      {selectedGroup && (
        <EventDetailModal
          request={selectedGroup.requests[0]}
          requests={selectedGroup.requests}
          busy={busy}
          onApprove={() => handleApprove(selectedGroup)}
          onAlwaysAllow={() => handleAlwaysAllow(selectedGroup)}
          onDeny={() => handleDeny(selectedGroup)}
          onAlwaysDeny={() => handleAlwaysDeny(selectedGroup)}
          onClose={() => setSelectedGroup(null)}
          zIndex={510}
        />
      )}

      {selectedNip46 && (
        <EventDetailModal
          request={selectedNip46.requests[0]}
          requests={selectedNip46.requests}
          busy={busy}
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
