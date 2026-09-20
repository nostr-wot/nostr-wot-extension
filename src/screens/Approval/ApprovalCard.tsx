import FollowReplacementNotice from '@components/FollowReplacementNotice';
import { t } from '@services/i18n/i18n.ts';
import { formatPermissionLabel } from '@services/i18n/permissionLabels.ts';
import type { ApprovalGroup } from '@domain/permissions/approval.ts';
import IconClose from '@assets/IconClose.tsx';
import IconSync from '@assets/IconSync.tsx';
import Card from '@components/Card';
import IconButton from '@components/IconButton';
import ListRow from '@components/ListRow';
import Container from '@components/Container';
import Text from '@components/Text';
import SiteIcon from '@components/SiteIcon';
import { KIND_LABELS } from '@constants/nostr.ts';

interface ApprovalCardProps {
  group: ApprovalGroup;
  onClick: () => void;
  onCancel?: () => void;
}

export default function ApprovalCard({ group, onClick, onCancel }: ApprovalCardProps) {
  const domain = group.origin;
  const firstReq = group.requests[0];
  const label = formatPermissionLabel(firstReq?.permKey || group.method, firstReq?.event);
  const isNip46 = group.nip46InFlight;
  const kind = firstReq?.eventKind ?? firstReq?.event?.kind;

  return (
    <Card variant="flat" className="p-0 mb-0 overflow-hidden">
      <Container variant="row" gap={2}>
        <ListRow leading={<SiteIcon domain={domain} />} leadingChip={false}
          title={domain} onClick={onClick} trailing={isNip46 ? null : undefined}
          subtitle={<Container as="span" gap={1}>
            <Container as="span" variant="row" gap={3}>
              {isNip46 && <IconSync size={12} className="animate-spin [animation-duration:1.5s] shrink-0" />}
              {isNip46 ? t('approval.awaitingSigner') : label}
            </Container>
            {!isNip46 && kind !== undefined && <Text as="span" variant="secondary" className="text-xs text-menu-subtitle">
              {formatPermissionLabel(group.method)} · {KIND_LABELS[kind] || `Kind ${kind}`} ({kind})
            </Text>}
            {!isNip46 && group.requests.length > 1 && <Text variant="muted" as="span">
              {t('approval.requests', { count: group.requests.length })}
            </Text>}
          </Container>}
        />
        {isNip46 && onCancel && <IconButton tone="brand"
          onClick={onCancel} aria-label={t('approval.cancelNip46')} title={t('approval.cancelNip46')}>
          <IconClose size={16} aria-hidden="true" />
        </IconButton>}
      </Container>
      {!isNip46 && <FollowReplacementNotice requests={group.requests}/>}
    </Card>
  );
}
