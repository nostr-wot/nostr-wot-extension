import type { NostrEventDisplay } from '@domain/nostr/nostrEvent';
import { t } from '@services/i18n/i18n';
import Container from '@components/Container';
import Text from '@components/Text';

/** NIP-29 create-group uses h, not the metadata event's d identifier. */
export default function CreateGroupPreview({event}:{event:Partial<NostrEventDisplay>}) {
 const group=event.tags?.find(tag=>tag[0]==='h')?.[1];
 const about=event.tags?.find(tag=>tag[0]==='about')?.[1];
 return <Container gap={3} className="min-w-0">
  <Text variant="secondary">{t('event.groupId')}: <Text as="span" mono className="text-brand [overflow-wrap:anywhere]">{group || t('event.groupIdMissing')}</Text></Text>
  {about && <Text className="[overflow-wrap:anywhere]">{about}</Text>}
  {event.content && <Text className="whitespace-pre-wrap [overflow-wrap:anywhere]">{t('approval.detail.content')}: {event.content}</Text>}
 </Container>;
}
