import { t } from '@lib/i18n.js';
import { formatPermissionLabel } from '@domain/permissions/permissionLabels.ts';
import type { ApprovalGroup } from '@domain/permissions/approval.ts';
import { IconChevronRight, IconSync } from '@assets';
import Card from '@components/Card/Card';

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

  return (
    <Card
      as="button"
      variant="flat"
      className={`w-full py-6 px-7 mb-0 flex items-center gap-5 text-left font-[inherit] transition-colors ${
        isNip46
          ? 'cursor-default opacity-75 border-dashed hover:bg-card hover:border-card-border'
          : 'cursor-pointer hover:bg-card-active hover:border-brand-light'
      }`}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="text-md font-semibold text-heading">{domain}</div>
        <div className="text-sm text-body flex items-center gap-3">
          {isNip46 && <IconSync size={12} className="animate-spin [animation-duration:1.5s] shrink-0" />}
          {isNip46 ? t('approval.awaitingSigner') : label}
        </div>
        {!isNip46 && group.requests.length > 1 && (
          <div className="text-xs text-muted">{t('approval.requests', { count: group.requests.length })}</div>
        )}
      </div>
      {isNip46 && onCancel ? (
        // Not IconButton: its tone="danger" only colours :hover, staying
        // chromeless at rest by design. This has to read as cancellable
        // without a hover — an async NIP-46 wait with no other visible
        // control — so it keeps its own always-visible border and glyph.
        <button
          className="shrink-0 w-12 h-12 p-0 flex items-center justify-center border border-[rgba(239,68,68,0.3)] rounded-sm bg-transparent text-error text-2xl leading-none cursor-pointer font-[inherit] transition-all hover:bg-[rgba(239,68,68,0.08)] hover:border-[rgba(239,68,68,0.5)]"
          onClick={(e) => { e.stopPropagation(); onCancel(); }}
          title={t('approval.cancelNip46')}
        >
          &times;
        </button>
      ) : !isNip46 ? <IconChevronRight size={16} className="shrink-0 text-muted" /> : null}
    </Card>
  );
}
