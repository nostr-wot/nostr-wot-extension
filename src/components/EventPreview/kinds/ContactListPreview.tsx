import { t } from '@services/i18n/i18n.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import FieldDisplay from '@components/FieldDisplay/FieldDisplay';
import { EP } from '../eventPreviewClasses.ts';

interface ContactListPreviewProps {
  event: NostrEventDisplay;
}

export default function ContactListPreview({ event }: ContactListPreviewProps) {
  const count = event.tags?.filter((tag) => tag[0] === 'p').length || 0;
  return (
    <>
      <h3 className={EP.sectionTitle}>{t('event.contactList')}</h3>
      <FieldDisplay label={t('event.contacts')} value={t('event.nEntries', { count })} />
    </>
  );
}
