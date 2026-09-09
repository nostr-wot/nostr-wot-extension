import React, { useState } from 'react';
import { t } from '@services/i18n/i18n.ts';
import { IconWarning } from '@assets';
import { KIND_LABELS } from '@constants/nostr.ts';
import { formatPermissionLabel } from '@services/i18n/permissionLabels.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import FieldDisplay from '@components/FieldDisplay/FieldDisplay';
import ProfilePreview from './kinds/ProfilePreview';
import NotePreview from './kinds/NotePreview';
import ContactListPreview from './kinds/ContactListPreview';
import DeletionPreview from './kinds/DeletionPreview';
import RepostPreview from './kinds/RepostPreview';
import ReactionPreview from './kinds/ReactionPreview';
import SealedPreview from './kinds/SealedPreview';
import AppSpecificPreview from './kinds/AppSpecificPreview';
import GenericPreview from './kinds/GenericPreview';
import { EP } from './eventPreviewClasses.ts';

/** Maps event kind to component. Entries here skip the generic fallback. */
const KIND_RENDERERS: Record<number, React.ComponentType<{ event: NostrEventDisplay }>> = {
  0: ProfilePreview,
  1: NotePreview,
  3: ContactListPreview,
  5: DeletionPreview,
  6: RepostPreview,
  7: ReactionPreview,
  13: SealedPreview,
  1059: SealedPreview,
  30078: AppSpecificPreview,
};

const ENCRYPT_TYPES = new Set(['nip04Encrypt', 'nip04Decrypt', 'nip44Encrypt', 'nip44Decrypt']);

interface EventPreviewProps {
  type: string | null;
  /** Partial because a queued approval carries a snapshot of the event, and
   *  `PendingRequest.event` is a `Partial<UnsignedEvent>`. An event with no
   *  `kind` already falls through to the unknown-event branch below, so this
   *  only makes the signature admit what callers were always passing. */
  event: Partial<NostrEventDisplay> | null;
  theirPubkey?: string | null;
  className?: string;
  compact?: boolean;
}

/**
 * Renders a human-readable preview of a Nostr event or NIP-07 request.
 * Dispatches to kind-specific components for signEvent, handles
 * encrypt/decrypt and getPublicKey inline.
 */
export default function EventPreview({ type, event, theirPubkey, className = '', compact = false }: EventPreviewProps) {
  const [showRaw, setShowRaw] = useState<boolean>(false);
  const rootCls = [EP.root, className].filter(Boolean).join(' ');

  // Encryption / decryption
  if (ENCRYPT_TYPES.has(type!)) {
    return (
      <div className={rootCls}>
        <h3 className={EP.sectionTitle}>{formatPermissionLabel(type || '')}</h3>
        {theirPubkey && <FieldDisplay label={t('event.recipient')} value={theirPubkey} mono />}
        <div className={EP.eventNote}>{t('event.encryptedDesc')}</div>
      </div>
    );
  }

  // getPublicKey
  if (type === 'getPublicKey') {
    return (
      <div className={rootCls}>
        <h3 className={EP.sectionTitle}>{formatPermissionLabel(type || '')}</h3>
        <div className={EP.eventNote}>{t('activity.detail.readKeyDesc')}</div>
      </div>
    );
  }

  // signEvent — no event data
  if (!event) {
    return (
      <div className={rootCls}>
        <div className={EP.eventNote}>{t('event.noEventData')}</div>
      </div>
    );
  }

  // signEvent — dispatch to kind component.
  // -1 stands in for a snapshot that carries no kind: it matches no renderer and
  // no label, so it lands in the "unknown event" branch, which is the honest
  // rendering of "we were not told what this is".
  const kind = event.kind ?? -1;
  const kindLabel = KIND_LABELS[kind] || `Kind ${kind}`;
  const KindComponent = KIND_RENDERERS[kind];

  return (
    <div className={rootCls}>
      <FieldDisplay label={t('event.kind')} value={`${kind} — ${kindLabel}`} />

      {/* Both branches are gated on `kind` matching a known renderer or label,
          which a snapshot without a kind never does — so by here the event is
          the full one a signEvent request carries. */}
      {KindComponent ? (
        <KindComponent event={event as NostrEventDisplay} />
      ) : KIND_LABELS[kind] ? (
        <GenericPreview event={event as NostrEventDisplay} />
      ) : (
        <><div className={EP.unknownWarning}>
          <IconWarning size={14} />
          <span>{t('event.unknownKind')}</span>
        </div><GenericPreview event={event as NostrEventDisplay} /></>
      )}

      {/* Always list every tag, for every kind — the user must be able to see
          the FULL payload being signed, not just the kind-specific summary. */}
      {event.tags && event.tags.length > 0 && (
        <details open={compact ? undefined : true}>
          <summary className="text-sm font-semibold text-secondary cursor-pointer mt-5 py-2">
            {t('event.tags', { count: event.tags.length })}
          </summary>
          <div className={EP.tagsList}>
            {event.tags.map((tag, i) => (
              <div key={i} className={EP.tagRow}>{JSON.stringify(tag)}</div>
            ))}
          </div>
        </details>
      )}

      <button
        type="button"
        aria-expanded={showRaw}
        className={EP.expandToggle}
        onClick={() => setShowRaw(!showRaw)}
      >
        {showRaw ? t('approval.detail.hideDetails') : t('approval.detail.moreDetails')}
      </button>
      {showRaw && (
        <pre className={EP.jsonPreview}>{JSON.stringify(event, null, 2)}</pre>
      )}
    </div>
  );
}
