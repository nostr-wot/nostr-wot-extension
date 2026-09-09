import { t } from '@services/i18n/i18n.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import { EP } from '../eventPreviewClasses.ts';

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
      <h3 className={EP.sectionTitle}>
        {isLike ? t('event.like') : isDislike ? t('event.dislike') : t('event.reaction')}
      </h3>
      {isCustomEmoji && <div className={EP.reactionEmoji}>{content}</div>}
      {target && <div className={EP.eventNote}>{t('event.reactingToNote')}</div>}
    </>
  );
}
