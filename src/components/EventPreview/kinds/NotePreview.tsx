import React from 'react';
import { t } from '@lib/i18n.js';
import styles from '../EventPreview.module.css';

interface NostrEvent {
  kind: number;
  content: string;
  tags?: string[][];
  [key: string]: unknown;
}

interface NotePreviewProps {
  event: NostrEvent;
}

export default function NotePreview({ event }: NotePreviewProps) {
  const isReply = event.tags?.some((tag) => tag[0] === 'e');
  return (
    <>
      <h3 className={styles.sectionTitle}>{isReply ? t('event.reply') : t('event.shortNote')}</h3>
      {/* Full content, scrollable — the prompt must show everything being signed */}
      <div className={styles.noteContent}>{event.content}</div>
    </>
  );
}
