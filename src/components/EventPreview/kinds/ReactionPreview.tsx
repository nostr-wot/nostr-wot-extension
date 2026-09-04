import React from 'react';
import { t } from '@lib/i18n.js';
import type { NostrEventDisplay } from '@shared/nostrEvent.ts';
import styles from '../EventPreview.module.css';

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
      <h3 className={styles.sectionTitle}>
        {isLike ? t('event.like') : isDislike ? t('event.dislike') : t('event.reaction')}
      </h3>
      {isCustomEmoji && <div className={styles.reactionEmoji}>{content}</div>}
      {target && <div className={styles.eventNote}>{t('event.reactingToNote')}</div>}
    </>
  );
}
