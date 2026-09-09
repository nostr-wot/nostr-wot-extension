import TextBlock from '@components/TextBlock';
import { t } from '@services/i18n/i18n.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import Heading from '@components/Heading';

interface NotePreviewProps {
  event: NostrEventDisplay;
}

export default function NotePreview({ event }: NotePreviewProps) {
  const isReply = event.tags?.some((tag) => tag[0] === 'e');
  return (
    <>
      <Heading level={5} as="h3" className="m-0 mb-4">{isReply ? t('event.reply') : t('event.shortNote')}</Heading>
      {/* Full content, scrollable — the prompt must show everything being signed */}
      <TextBlock>{event.content}</TextBlock>
    </>
  );
}
