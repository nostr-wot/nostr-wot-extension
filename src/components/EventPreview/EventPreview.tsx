import React, { useState } from 'react';
import { t } from '@lib/i18n.js';
import { IconWarning } from '@assets';
import { KIND_LABELS } from '@shared/constants.ts';
import { formatLabel } from '@shared/permissions.ts';
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
import styles from './EventPreview.module.css';

interface NostrEvent {
  kind: number;
  content: string;
  tags?: string[][];
  [key: string]: unknown;
}

/** Maps event kind to component. Entries here skip the generic fallback. */
const KIND_RENDERERS: Record<number, React.ComponentType<{ event: NostrEvent }>> = {
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
  event: Partial<NostrEvent> | null;
  theirPubkey?: string | null;
  className?: string;
}

/**
 * Renders a human-readable preview of a Nostr event or NIP-07 request.
 * Dispatches to kind-specific components for signEvent, handles
 * encrypt/decrypt and getPublicKey inline.
 */
export default function EventPreview({ type, event, theirPubkey, className = '' }: EventPreviewProps) {
  const [showRaw, setShowRaw] = useState<boolean>(false);
  const rootCls = [styles.eventPreview, className].filter(Boolean).join(' ');

  // Encryption / decryption
  if (ENCRYPT_TYPES.has(type!)) {
    return (
      <div className={rootCls}>
        <h3 className={styles.sectionTitle}>{formatLabel(type || '')}</h3>
        {theirPubkey && <FieldDisplay label={t('event.recipient')} value={theirPubkey} mono />}
        <div className={styles.eventNote}>{t('event.encryptedDesc')}</div>
      </div>
    );
  }

  // getPublicKey
  if (type === 'getPublicKey') {
    return (
      <div className={rootCls}>
        <h3 className={styles.sectionTitle}>{formatLabel(type || '')}</h3>
        <div className={styles.eventNote}>{t('activity.detail.readKeyDesc')}</div>
      </div>
    );
  }

  // signEvent — no event data
  if (!event) {
    return (
      <div className={rootCls}>
        <div className={styles.eventNote}>{t('event.noEventData')}</div>
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
        <KindComponent event={event as NostrEvent} />
      ) : KIND_LABELS[kind] ? (
        <GenericPreview event={event as NostrEvent} />
      ) : (
        <div className={styles.unknownWarning}>
          <IconWarning size={14} />
          <span>{t('event.unknownKind')}</span>
        </div>
      )}

      {/* Always list every tag, for every kind — the user must be able to see
          the FULL payload being signed, not just the kind-specific summary. */}
      {event.tags && event.tags.length > 0 && (
        <>
          <h3 className={`${styles.sectionTitle} ${styles.tagsTitle}`}>
            {t('event.tags', { count: event.tags.length })}
          </h3>
          <div className={styles.tagsList}>
            {event.tags.map((tag, i) => (
              <div key={i} className={styles.tagRow}>{JSON.stringify(tag)}</div>
            ))}
          </div>
        </>
      )}

      <button
        className={styles.expandToggle}
        onClick={() => setShowRaw(!showRaw)}
      >
        {showRaw ? t('approval.detail.hideDetails') : t('approval.detail.moreDetails')}
      </button>
      {showRaw && (
        <pre className={styles.jsonPreview}>{JSON.stringify(event, null, 2)}</pre>
      )}
    </div>
  );
}
