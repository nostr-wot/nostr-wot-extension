import type { NostrEventDisplay } from '@domain/nostr/nostrEvent';
import TextBlock from '@components/TextBlock';
import Text from '@components/Text';
import { t } from '@services/i18n/i18n.ts';
import Heading from '@components/Heading';

export default function RepostPreview({event}:{event:NostrEventDisplay}) {
  let content = event.content;
  try {
    const repost = JSON.parse(event.content);
    if (repost && typeof repost.content === 'string') content = repost.content;
  } catch { /* Show the literal payload when it is not an embedded event. */ }
  return (
    <>
      <Heading level={5} as="h3" className="m-0 mb-4">{t('event.repost')}</Heading>
      <Text variant="hint" className="text-sm italic mt-2">{t('event.repostingNote')}</Text>
      {content && <TextBlock>{content}</TextBlock>}
    </>
  );
}
