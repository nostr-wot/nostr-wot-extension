import React, { useMemo } from 'react';
import { t } from '@lib/i18n.js';
import { formatPermissionLabel } from '@domain/permissions/permissionLabels.ts';
import { formatTime } from '@utils/format/time.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import EventPreview from '@components/EventPreview/EventPreview';
import StatusDot from '@components/StatusDot/StatusDot';
import Button from '@components/Button/Button';
import type { ActivityEntry } from '@domain/activity/activity.ts';

const CLS = {
  // The modal fills the fixed-height popup, so the event body must scroll
  // and the approve/deny actions must stay pinned. flex/min-h-0 all the way
  // down is what gives .scrollArea a bounded height to actually scroll
  // within, instead of growing to fit and being clipped dead by the card.
  content: 'flex flex-col gap-5 flex-1 min-h-0',
  scrollArea: 'flex flex-col gap-5 flex-1 min-h-0 overflow-y-auto overscroll-contain',
  origin: 'text-xl font-bold text-heading',
  summary: 'flex flex-col gap-2',
  methodBadge: 'inline-flex self-start text-xs font-semibold px-5 py-[3px] rounded-panel bg-brand-light text-brand-hover',
  description: 'text-md text-body mt-2 leading-[1.45]',
  countNote: 'text-sm text-muted text-center pt-2',
  // [&+&]: the border between consecutive entry blocks, without one trailing
  // the last or leading the first — no descendant/adjacent CSS selector can
  // be reached from a plain className, but Tailwind's arbitrary variant can.
  entryBlock: 'flex flex-col gap-3 [&+&]:pt-5 [&+&]:border-t [&+&]:border-t-card',
  entryHeader: 'flex items-center gap-3',
  entryTime: 'text-xs text-muted font-mono',
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
 *  `PendingRequest` in lib/types.ts, which is what callers actually pass —
 *  `permKey` is nullable there, and narrowing it here made every call site a
 *  type error. */
interface ApprovalRequest {
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

function entryType(entry: ActivityEntry): string {
  if (entry.method === 'signEvent') return 'signEvent';
  if (entry.method === 'getPublicKey') return 'getPublicKey';
  return entry.method;
}

function entryFingerprint(entry: ActivityEntry): string {
  if (entry.event) return JSON.stringify(entry.event);
  return entry.theirPubkey || '';
}

interface EventDetailModalProps {
  // Activity mode
  group?: ActivityGroup | null;
  // Approval mode
  request?: ApprovalRequest | null;
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
  // Approval mode
  request,
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
  const type = isApproval ? request!.type : null;
  const permKey = isApproval ? (request!.permKey || request!.type) : group?.methodKey;
  const event = isApproval ? request!.event : group?.entries?.[0]?.event;
  const origin = isApproval ? request!.origin : group?.domain;
  const theirPubkey = isApproval ? request!.theirPubkey : group?.entries?.[0]?.theirPubkey;
  const entries = group?.entries || [];

  const title = formatPermissionLabel(permKey || '', event ?? undefined);

  // For activity: deduplicate entries by content
  const uniqueEntries = useMemo(() => {
    if (entries.length <= 1) return entries;
    const seen = new Set<string>();
    const unique: ActivityEntry[] = [];
    for (const entry of entries) {
      const fp = entryFingerprint(entry);
      if (!seen.has(fp)) {
        seen.add(fp);
        unique.push(entry);
      }
    }
    return unique;
  }, [entries]);

  const allIdentical = uniqueEntries.length <= 1;

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
        <div className={CLS.scrollArea}>
          {/* Origin / domain */}
          {origin && (
            <div className={CLS.origin}>{origin}</div>
          )}

          {/* Approval: method badge + description */}
          {isApproval && (
            <div className={CLS.summary}>
              <div className={CLS.methodBadge}>{title}</div>
              {description && <p className={CLS.description}>{description}</p>}
            </div>
          )}

          {/* Event content */}
          {isApproval ? (
            <EventPreview
              type={type}
              event={event || null}
              theirPubkey={theirPubkey}
            />
          ) : allIdentical ? (
            <>
              {entries.length > 0 && (
                <EventPreview
                  type={entryType(entries[0])}
                  event={entries[0].event || null}
                  theirPubkey={entries[0].theirPubkey || null}
                />
              )}
              {entries.length > 1 && (
                <div className={CLS.countNote}>
                  &times;{entries.length} {t('activity.requests', { count: entries.length })}
                </div>
              )}
            </>
          ) : (
            uniqueEntries.map((entry, i) => (
              <div key={i} className={CLS.entryBlock}>
                <div className={CLS.entryHeader}>
                  <StatusDot status={entry.decision || ''} />
                  <span className={CLS.entryTime}>{formatTime(entry.timestamp ?? 0)}</span>
                </div>
                <EventPreview
                  type={entryType(entry)}
                  event={entry.event || null}
                  theirPubkey={entry.theirPubkey || null}
                />
              </div>
            ))
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
            <Button variant="danger" small onClick={onDeny}>
              {t('approval.cancelNip46')}
            </Button>
          </div>
        )}

        {/* Approval action buttons */}
        {isApproval && (
          <div className={CLS.actions}>
            <div className={CLS.actionsRow}>
              <Button variant="danger" small onClick={onAlwaysDeny}>
                {t('approval.alwaysDenyLabel', { label: title })}
              </Button>
              <Button variant="secondary" small onClick={onDeny}>
                {t('approval.deny')}
              </Button>
            </div>
            <div className={CLS.actionsRow}>
              <Button variant="secondary" small onClick={onAlwaysAllow}>
                {t('approval.alwaysAllowLabel', { label: title })}
              </Button>
              <Button small onClick={onApprove}>
                {t('approval.allow')}
              </Button>
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
