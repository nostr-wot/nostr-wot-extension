import { t } from '@services/i18n/i18n.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import FieldDisplay from '@components/FieldDisplay';
import Heading from '@components/Heading';

interface ContactListPreviewProps {
  event: NostrEventDisplay;
}

export default function ContactListPreview({ event }: ContactListPreviewProps) {
  const count = event.tags?.filter((tag) => tag[0] === 'p').length || 0;
  return (
    <>
      <Heading level={5} as="h3" className="m-0 mb-4">{t('event.contactList')}</Heading>
      <FieldDisplay label={t('event.contacts')} value={t('event.nEntries', { count })} />
    </>
  );
}
