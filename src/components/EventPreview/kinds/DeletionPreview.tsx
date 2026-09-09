import Text from '@components/Text';
import { t } from '@services/i18n/i18n.ts';
import { truncate } from '@utils/format/text.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import FieldDisplay from '@components/FieldDisplay';
import Heading from '@components/Heading';

interface DeletionPreviewProps {
  event: NostrEventDisplay;
}

export default function DeletionPreview({ event }: DeletionPreviewProps) {
  const ids = event.tags?.filter((tag) => tag[0] === 'e').map((tag) => tag[1]) || [];
  return (
    <>
      <Heading level={5} as="h3" className="m-0 mb-4">{t('event.eventDeletion')}</Heading>
      <FieldDisplay label={t('event.count')} value={t('event.nEvents', { count: ids.length })} />
      {ids.slice(0, 3).map((id) => (
        <FieldDisplay key={id} label={t('event.id')} value={truncate(id, 24)} mono />
      ))}
      {ids.length > 3 && <Text variant="hint" className="text-sm italic mt-2">{t('event.andMore', { count: ids.length - 3 })}</Text>}
    </>
  );
}
