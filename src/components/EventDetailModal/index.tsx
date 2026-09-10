import { KIND_LABELS } from '@constants/nostr.ts';
import { t } from '@services/i18n/i18n.ts';
import { formatPermissionLabel } from '@services/i18n/permissionLabels.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import OverlayPanel from '@components/OverlayPanel';
import EventPreview from '@components/EventPreview';
import SiteIcon from '@components/SiteIcon';
import ActivityGroupDetail from './ActivityGroupDetail';
import Button, { ButtonDanger, ButtonSecondary } from '@components/Button';
import Text from '@components/Text';
import type { ActivityEntry } from '@domain/activity/activity.ts';

const CLS = {
  // The modal fills the fixed-height popup, so the event body must scroll
  // and the approve/deny actions must stay pinned. flex/min-h-0 all the way
  // down is what gives .scrollArea a bounded height to actually scroll
  // within, instead of growing to fit and being clipped dead by the card.
  content: 'flex flex-col gap-5 flex-1 min-h-0',
  scrollArea: 'flex flex-col gap-5 flex-1 min-h-0 overflow-y-auto overscroll-contain',
  summary: 'flex flex-col gap-2',
  methodBadge: 'inline-flex self-start text-xs font-semibold px-5 py-[3px] rounded-panel bg-brand-light text-brand-hover',
  description: 'text-md text-body mt-2 leading-[1.45]',
  // flex-shrink-0: never scroll away with the body -- the user must always
  // be able to decide.
  actions: 'flex flex-col gap-4 pt-6 border-t border-card-border mt-2 shrink-0',
  actionsRow: 'flex gap-4 [&>*]:flex-1',
  nip46Pending: 'flex items-center gap-5 px-7 py-6 bg-brand-light rounded-panel text-md font-medium text-brand-hover',
  nip46Spinner: 'w-4 h-4 rounded-full border-2 border-brand-light border-t-brand animate-spin shrink-0',
};

interface ActivityGroup {
  methodKey?: string;
  domain?: string;
  entries?: ActivityEntry[];
}

/** The fields this view reads off a pending request. Structurally satisfied by
 *  `PendingRequest` in domain/signing/types.ts, which is what callers actually pass —
 *  `permKey` is nullable there, and narrowing it here made every call site a
 *  type error. */
interface ApprovalRequest {
  id?: string;
  type: string;
  /** Nullable: the canonical PendingRequest has it as `string | null`, and
   *  narrowing it here made every call site a type error. */
  permKey?: string | null;
  /** Partial on purpose: a queued request carries a snapshot, and for the
   *  non-signing methods there is no event on it at all. */
  event?: Partial<NostrEventDisplay> | null;
  origin?: string;
  theirPubkey?: string | null;
  pubkey?: string;
}

interface EventDetailModalProps {
  // Activity mode
  group?: ActivityGroup | null;
  selectedAccountPubkey?: string;
  // Approval mode
  request?: ApprovalRequest | null;
  requests?: ApprovalRequest[];
  busy?: boolean;
  onApprove?: () => void;
  onDeny?: () => void;
  onAlwaysAllow?: () => void;
  onAlwaysDeny?: () => void;
  // NIP-46 read-only mode
  nip46InFlight?: boolean;
  // Modal
  onClose?: () => void;
  onBack?: (() => void) | null;
  zIndex?: number;
}

/**
 * Unified event detail modal. Used for both activity detail and approval review.
 *
 * Activity mode: pass `group` with entries array. No action buttons.
 * Approval mode: pass `request` object + action callbacks. Shows approve/deny buttons.
 */
export default function EventDetailModal({
  // Activity mode
  group,
  selectedAccountPubkey,
  // Approval mode
  request,
  requests,
  busy = false,
  onApprove,
  onDeny,
  onAlwaysAllow,
  onAlwaysDeny,
  // NIP-46 read-only mode
  nip46InFlight,
  // Modal
  onClose,
  onBack,
  zIndex = 350,
}: EventDetailModalProps) {
  const isApproval = !!request && !nip46InFlight;

  // Resolve display data from either group or request
  const type = request ? request!.type : null;
  const permKey = request ? (request!.permKey || request!.type) : group?.methodKey;
  const event = request ? request!.event : group?.entries?.[0]?.event;
  const origin = request ? request!.origin : group?.domain;
  const theirPubkey = request ? request!.theirPubkey : group?.entries?.[0]?.theirPubkey;
  const entries = group?.entries || [];

  const title = formatPermissionLabel(permKey || '', event ?? undefined);

  // Approval description
  const description = isApproval ? describeRequest(request!, title) : null;

  return (
    <OverlayPanel
      title={isApproval ? t('approval.detail.title') : title}
      onBack={onBack}
      onClose={onClose}
      zIndex={zIndex}
    >
      <div className={CLS.content}>
        {/* Scrollable event body -- the actions below stay pinned so a long
            event can never push them out of reach (see the CSS module). */}
        <div className={isApproval || nip46InFlight ? CLS.scrollArea : CLS.content}>
          {/* Origin / domain */}
          {origin && (
            <div className="flex items-center gap-4 min-w-0"><SiteIcon domain={origin} /><span className="text-lg font-semibold text-heading truncate">{origin}</span></div>
          )}

          {/* Approval: method badge + description */}
          {isApproval && (
            <div className={CLS.summary}>
              <div className={CLS.methodBadge}>{title}</div>
              {description && <p className={CLS.description}>{description}</p>}
            </div>
          )}

          {/* Event content */}
          {request && requests && requests.length > 1 ? (
            <div className="flex flex-col gap-4">
              <span className="text-sm text-menu-subtitle">{t('approval.requests', {count:requests.length})}</span>
              {requests.map((item, index) => (
                <details key={item.id ?? index} data-approval-request={item.id ?? index} className="rounded-panel border border-card-border p-5">
                  <summary className="cursor-pointer text-md text-heading">
                    {index + 1}. {formatPermissionLabel(item.permKey || item.type, item.event ?? undefined)}
                    {item.event?.kind !== undefined && <span className="block text-sm text-menu-subtitle">{KIND_LABELS[item.event.kind] || `Kind ${item.event.kind}`} ({item.event.kind})</span>}
                  </summary>
                  <div className="pt-5"><EventPreview type={item.type} event={item.event || null} theirPubkey={item.theirPubkey} /></div>
                </details>
              ))}
            </div>
          ) : request ? (
            <EventPreview
              type={type}
              event={event || null}
              theirPubkey={theirPubkey}
            />
          ) : (
            <ActivityGroupDetail entries={entries} selectedAccountPubkey={selectedAccountPubkey} />
          )}

          {/* NIP-46 in-flight: pending message (the cancel button is pinned below) */}
          {nip46InFlight && request && (
            <div className={CLS.nip46Pending}>
              <div className={CLS.nip46Spinner} />
              <span>{t('approval.pendingSignature')}</span>
            </div>
          )}
        </div>

        {/* NIP-46 in-flight: cancel button */}
        {nip46InFlight && request && onDeny && (
          <div className={CLS.actions}>
            <ButtonDanger small disabled={busy} onClick={onDeny}>
              {t('approval.cancelNip46')}
            </ButtonDanger>
          </div>
        )}

        {/* Approval action buttons */}
        {isApproval && (
          <div className={CLS.actions}>
            <div className={CLS.actionsRow}>
              <ButtonSecondary small disabled={busy || !onDeny} onClick={onDeny}>
                {t('approval.deny')}
              </ButtonSecondary>
              <Button small disabled={busy || !onApprove} onClick={onApprove}>
                {t(requests && requests.length > 1 ? 'approval.approveShown' : 'approval.approveOnce')}
              </Button>
            </div>
            <Text variant="muted">{t('approval.rememberHint')}</Text>
            <div className={CLS.actionsRow}>
              <ButtonDanger small outline disabled={busy || !onAlwaysDeny} onClick={onAlwaysDeny}>
                {t('approval.alwaysDenyLabel', { label: title })}
              </ButtonDanger>
              <ButtonSecondary small outline disabled={busy || !onAlwaysAllow} onClick={onAlwaysAllow}>
                {t('approval.alwaysAllowLabel', { label: title })}
              </ButtonSecondary>
            </div>
          </div>
        )}
      </div>
    </OverlayPanel>
  );
}

function describeRequest(req: ApprovalRequest, label: string): string | null {
  const origin = req.origin || '?';
  switch (req.type) {
    case 'getPublicKey':
      return t('approval.detail.readProfileDesc', { origin });
    case 'signEvent':
      return t('approval.detail.signDesc', { origin, label: label || 'sign an event' });
    case 'nip04Encrypt':
    case 'nip44Encrypt':
      return t('approval.detail.sendDesc', { origin });
    case 'nip04Decrypt':
    case 'nip44Decrypt':
      return t('approval.detail.readDesc', { origin });
    default:
      return null;
  }
}
