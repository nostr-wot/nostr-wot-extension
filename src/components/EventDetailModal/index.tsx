import GroupedMessageRequests from './GroupedMessageRequests';
import IconChevronDown from '@assets/IconChevronDown';
import IntentText from './IntentText';
import { useId, useState, type ReactNode } from 'react';
import Checkbox from '@components/Checkbox';
import IconWarning from '@assets/IconWarning';
import { signingIntentParts, intentParts } from '@services/i18n/eventIntent.ts';
import StatusNotice from '@components/StatusNotice';
import MessageRequestDetail, { isMessageRequest } from './MessageRequestDetail';
import AuthenticationNotice from '@components/AuthenticationNotice';
import AuthenticationActions from '@components/AuthenticationActions';
import type { AuthenticationRequest, AuthenticationScope } from '@domain/signing/authentication.ts';
import { KIND_LABELS } from '@constants/nostr.ts';
import { t } from '@services/i18n/i18n.ts';
import { formatPermissionLabel } from '@services/i18n/permissionLabels.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import OverlayPanel from '@components/OverlayPanel';
import FormError from '@components/FormError';
import EventPreview from '@components/EventPreview';
import SiteIcon from '@components/SiteIcon';
import ActivityGroupDetail from './ActivityGroupDetail';
import Button, { ButtonDanger } from '@components/Button';
import ApprovalActions from '@components/ApprovalActions';
import FollowReplacementNotice from '@components/FollowReplacementNotice';
import type { ActivityEntry } from '@domain/activity/activity.ts';

const CLS = {
  // The bottom sheet grows with its contents until it fills the popup. Only
  // this body then scrolls; the header and decision buttons stay visible.
  content: 'flex flex-col gap-5 flex-1 min-h-0',
  scrollArea: 'flex-1 min-h-0 overflow-y-auto overscroll-contain',
  summary: 'flex flex-col gap-2',
  methodBadge: 'inline-flex self-start text-xs font-semibold px-5 py-[3px] rounded-panel bg-brand-light text-brand-hover',
  description: 'text-md text-body mt-2 leading-[1.45]',
  // flex-shrink-0: never scroll away with the body -- the user must always
  // be able to decide.
  actions: 'flex flex-col gap-4 pt-6 border-t border-card-border mt-2 shrink-0',
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
  authentication?: AuthenticationRequest;
  followReplacementCount?: number;
  followReplacementNewCount?: number;
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
  actionError?: string;
  onApproveSelected?: (ids:string[]) => void;
  onDenyRequest?: (id:string) => void;
  onApprove?: () => void;
  onAuthenticate?: (scope: AuthenticationScope) => void;
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
  actionError,
  onApproveSelected, onDenyRequest,
  onApprove,
  onAuthenticate,
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
  const selectionPrefix=useId();
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const selectable=!!(requests && requests.length>1 && !nip46InFlight && onApproveSelected);
  const selected=(requests || []).filter(item=>item.id && selectedIds.includes(item.id)).map(item=>item.id!);
  const isApproval = !!request && !nip46InFlight;

  // Resolve display data from either group or request
  const type = request ? request!.type : null;
  const permKey = request ? (request!.permKey || request!.type) : group?.methodKey;
  const event = request ? request!.event : group?.entries?.[0]?.event;
  const origin = request ? request!.origin : group?.domain;
  const theirPubkey = request ? request!.theirPubkey : group?.entries?.[0]?.theirPubkey;
  const entries = group?.entries || [];

  const title = formatPermissionLabel(request?.authentication ? `signEvent:${request.authentication.protocol === 'nip98' ? 27235 : 22242}` : permKey || '', requests && requests.length > 1 ? undefined : event ?? undefined);

  // Approval description
  const description = request ? describeRequest(request) : null;

  const renderRequest = (item: ApprovalRequest, index: number, label?: ReactNode) => {
    const labelId = `${selectionPrefix}-${item.id ?? index}`;
    const cancel = nip46InFlight && item.id && onDenyRequest ? (
      <ButtonDanger small outline disabled={busy} onClick={() => onDenyRequest(item.id!)}>
        {t('approval.cancelNip46')}
      </ButtonDanger>
    ) : null;
    const requestLabel = label || describeRequest(item) || (
      <span className="text-brand">{formatPermissionLabel(item.permKey || item.type, item.event ?? undefined)}</span>
    );
    return <div key={item.id ?? index} className="relative">
      {item.type === 'signEvent' ? (
        <div data-approval-request={item.id ?? index} className="rounded-panel border border-card-border p-5">
          <div id={labelId} className={selectable ? 'pr-8' : ''}>{describeRequest(item)}</div>
          <div className="pt-3"><EventPreview type="signEvent" event={item.event || {}} approval /></div>
          {cancel}
        </div>
      ) : (
        <details data-approval-request={item.id ?? index} className="group/request rounded-panel border border-card-border p-5">
          <summary id={labelId} className={`${selectable ? 'pr-8 ' : ''}flex flex-col gap-2 cursor-pointer text-md list-none [&::-webkit-details-marker]:hidden [&::marker]:content-['']`}>
            <span>{requestLabel}</span>
            <IconChevronDown aria-hidden="true" className="self-end text-secondary transition-transform group-open/request:rotate-180" />
          </summary>
          <div className="pt-5">
            {isMessageRequest(item.type)
              ? <MessageRequestDetail key={item.id} request={item} showSender={!label} />
              : <EventPreview type={item.type} event={item.event || null} theirPubkey={item.theirPubkey} />}
          </div>
          {cancel && <div className="flex justify-end pt-5">{cancel}</div>}
        </details>
      )}
      {selectable && item.id && <div className="absolute right-5 top-5">
        <Checkbox disabled={busy} checked={selected.includes(item.id)} aria-label={t('approval.selectRequest')}
          aria-describedby={labelId} onChange={event => setSelectedIds(previous => event.target.checked
            ? [...previous, item.id!] : previous.filter(id => id !== item.id))} />
      </div>}
    </div>;
  };

  let eventContent: ReactNode;
  if (request && requests && requests.length > 1) {
    eventContent = <div className="flex flex-col gap-4">
      <span className="text-sm text-menu-subtitle">{t('approval.requests', { count: requests.length })}</span>
      {requests.every(item => isMessageRequest(item.type))
        ? <GroupedMessageRequests requests={requests} renderRequest={(item, label) => renderRequest(item, requests.indexOf(item), label)} />
        : requests.map((item, index) => renderRequest(item, index))}
    </div>;
  } else if (request?.type === 'signEvent') {
    eventContent = <EventPreview type="signEvent" event={event || {}} approval />;
  } else if (request && isMessageRequest(type)) {
    eventContent = <MessageRequestDetail key={request.id} request={request} />;
  } else if (request) {
    eventContent = <EventPreview type={type} event={event || null} theirPubkey={theirPubkey} />;
  } else {
    eventContent = <ActivityGroupDetail entries={entries} selectedAccountPubkey={selectedAccountPubkey} />;
  }

  return (
    <OverlayPanel
      placement="bottom"
      title={isApproval && !request?.authentication ? t('approval.detail.title') : title}
      onBack={onBack}
      onClose={onClose}
      zIndex={zIndex}
    >
      <div className={CLS.content}>
        {/* Scrollable event body -- the actions below stay pinned so a long
            event can never push them out of reach (see the CSS module). */}
        <div className={CLS.scrollArea}>
          <div className="flex flex-col gap-5">
          <FormError>{actionError}</FormError>
          {/* Origin / domain */}
          {origin && (
            <div className="flex items-center gap-4 min-w-0"><SiteIcon domain={origin} /><span className="text-lg font-semibold text-heading truncate">{origin}</span></div>
          )}

          {/* Approval: method badge + description */}
          {request && !request.authentication && (
            <div className={CLS.summary}>
              {type !== 'signEvent' && <div className={CLS.methodBadge}>{title}</div>}
              {description && !isMessageRequest(type) && !(type === 'signEvent' && requests && requests.length > 1) && <p className={CLS.description}>{description}</p>}
            </div>
          )}

          {request?.authentication && <AuthenticationNotice request={request}/>}
          {request?.type === 'signEvent' && !request.authentication && (requests || [request]).some(item => item.event?.kind === undefined || !KIND_LABELS[item.event.kind]) && <StatusNotice tone="warn" variant="callout" icon={<IconWarning/>}>{t('event.unknownKind')}</StatusNotice>}
          <FollowReplacementNotice requests={requests || (request ? [request] : [])}/>

          {/* Event content */}
          {isMessageRequest(type) ? <div className="border-t border-card-border pt-6">{eventContent}</div> : eventContent}

          {/* NIP-46 in-flight: pending message (the cancel button is pinned below) */}
          {nip46InFlight && request && (
            <div className={CLS.nip46Pending}>
              <div className={CLS.nip46Spinner} />
              <span>{t('approval.pendingSignature')}</span>
            </div>
          )}
          </div>
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
            {selectable ? (
              <div className="flex justify-end gap-4">
                <Button small disabled={busy || !selected.length} onClick={() => onApproveSelected?.(selected)}>
                  {t('approval.approveSelected')}
                </Button>
                <ButtonDanger small outline disabled={busy || !onDeny} onClick={onDeny}>
                  {t('approval.rejectAll')}
                </ButtonDanger>
              </div>
            ) : request?.authentication ? (
              <AuthenticationActions authentication={request.authentication} requestCount={requests?.length || 1}
                busy={busy} onApprove={onAuthenticate} onDeny={onDeny} onAlwaysDeny={onAlwaysDeny} />
            ) : (
              <ApprovalActions requestCount={requests?.length || 1} busy={busy} placement="above"
                onApprove={onApprove} onReject={onDeny}
                choices={[{ value: permKey || '', label: title, onAlwaysAllow, onAlwaysDeny }]} />
            )}

          </div>
        )}
      </div>
    </OverlayPanel>
  );
}

function describeRequest(req: ApprovalRequest): ReactNode {
  const origin = req.origin || '?';
  switch (req.type) {
    case 'getPublicKey':
      return <IntentText parts={intentParts('approval.detail.readProfileDesc',{origin})}/>;
    case 'signEvent':
      return req.authentication ? <AuthenticationNotice request={req}/> : <IntentText parts={signingIntentParts(origin,req.event)}/>;
    case 'nip04Encrypt':
    case 'nip44Encrypt':
      return <IntentText parts={intentParts('approval.detail.sendDesc',{origin})}/>;
    case 'nip04Decrypt':
    case 'nip44Decrypt':
      return <IntentText parts={intentParts('approval.detail.readDesc',{origin})}/>;
    default:
      return null;
  }
}
