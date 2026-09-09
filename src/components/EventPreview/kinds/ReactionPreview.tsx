import Text from '@components/Text';
import { t } from '@services/i18n/i18n.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import Heading from '@components/Heading';

interface ReactionPreviewProps {
  event: NostrEventDisplay;
}

export default function ReactionPreview({ event }: ReactionPreviewProps) {
  const target = event.tags?.find((tag) => tag[0] === 'e')?.[1];
  const content = event.content;
  const isLike = !content || content === '+';
  const isDislike = content === '-';
  const isCustomEmoji = !isLike && !isDislike;

  return (
    <>
      <Heading level={5} as="h3" className="m-0 mb-4">
        {isLike ? t('event.like') : isDislike ? t('event.dislike') : t('event.reaction')}
      </Heading>
      {isCustomEmoji && <Text as="div" className="text-display leading-none my-2">{content}</Text>}
      {target && <Text variant="hint" className="text-sm italic mt-2">{t('event.reactingToNote')}</Text>}
    </>
  );
}
