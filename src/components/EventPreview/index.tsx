import React, { useState } from 'react';
import { cn } from '@utils/cn.ts';
import { t } from '@services/i18n/i18n.ts';
import IconWarning from '@assets/IconWarning.tsx';
import { KIND_LABELS } from '@constants/nostr.ts';
import { formatPermissionLabel } from '@services/i18n/permissionLabels.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import FieldDisplay from '@components/FieldDisplay';
import ProfilePreview from './kinds/ProfilePreview';
import NotePreview from './kinds/NotePreview';
import ContactListPreview from './kinds/ContactListPreview';
import DeletionPreview from './kinds/DeletionPreview';
import RepostPreview from './kinds/RepostPreview';
import ReactionPreview from './kinds/ReactionPreview';
import SealedPreview from './kinds/SealedPreview';
import AppSpecificPreview from './kinds/AppSpecificPreview';
import GenericPreview from './kinds/GenericPreview';
import Container from '@components/Container';
import Heading from '@components/Heading';
import Text from '@components/Text';
import TextBlock from '@components/TextBlock';
import DetailDisclosure from '@components/DetailDisclosure';
import StatusNotice from '@components/StatusNotice';
import { ButtonSecondary } from '@components/Button';

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

  // Encryption / decryption
  if (ENCRYPT_TYPES.has(type!)) {
    return (
      <Container variant="box" className={cn('min-w-0', className)}>
        <Heading level={5} as="h3" className="m-0 mb-4">{formatPermissionLabel(type || '')}</Heading>
        {theirPubkey && <FieldDisplay label={t('event.recipient')} value={theirPubkey} mono />}
        <Text variant="hint" className="text-sm italic mt-2">{t('event.encryptedDesc')}</Text>
      </Container>
    );
  }

  // getPublicKey
  if (type === 'getPublicKey') {
    return (
      <Container variant="box" className={cn('min-w-0', className)}>
        <Heading level={5} as="h3" className="m-0 mb-4">{formatPermissionLabel(type || '')}</Heading>
        <Text variant="hint" className="text-sm italic mt-2">{t('activity.detail.readKeyDesc')}</Text>
      </Container>
    );
  }

  // signEvent — no event data
  if (!event) {
    return (
      <Container variant="box" className={cn('min-w-0', className)}>
        <Text variant="hint" className="text-sm italic mt-2">{t('event.noEventData')}</Text>
      </Container>
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
    <Container variant="box" className={cn('min-w-0', className)}>
      <FieldDisplay label={t('event.kind')} value={`${kind} — ${kindLabel}`} />

      {/* Both branches are gated on `kind` matching a known renderer or label,
          which a snapshot without a kind never does — so by here the event is
          the full one a signEvent request carries. */}
      {KindComponent ? (
        <KindComponent event={event as NostrEventDisplay} />
      ) : KIND_LABELS[kind] ? (
        <GenericPreview event={event as NostrEventDisplay} />
      ) : (
        <><StatusNotice tone="warn" variant="callout" icon={<IconWarning size={14} />}>
          {t('event.unknownKind')}
        </StatusNotice><GenericPreview event={event as NostrEventDisplay} /></>
      )}

      {/* Always list every tag, for every kind — the user must be able to see
          the FULL payload being signed, not just the kind-specific summary. */}
      {event.tags && event.tags.length > 0 && (
        <DetailDisclosure open={compact ? undefined : true}
          label={t('event.tags', { count: event.tags.length })}
          content={event.tags.map(tag => JSON.stringify(tag)).join('\n')}
          maxHeight={140} className="mt-5" />
      )}

      <ButtonSecondary
        small
        type="button"
        aria-expanded={showRaw}
        className="mt-4 self-start"
        onClick={() => setShowRaw(!showRaw)}
      >
        {showRaw ? t('approval.detail.hideDetails') : t('approval.detail.moreDetails')}
      </ButtonSecondary>
      {showRaw && (
        <TextBlock mono maxHeight={200} className="mt-3">{JSON.stringify(event, null, 2)}</TextBlock>
      )}
    </Container>
  );
}
