import React from 'react';
import { t } from '@lib/i18n.js';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import { EP } from '../eventPreviewClasses.ts';

interface NotePreviewProps {
  event: NostrEventDisplay;
}

export default function NotePreview({ event }: NotePreviewProps) {
  const isReply = event.tags?.some((tag) => tag[0] === 'e');
  return (
    <>
      <h3 className={EP.sectionTitle}>{isReply ? t('event.reply') : t('event.shortNote')}</h3>
      {/* Full content, scrollable — the prompt must show everything being signed */}
      <div className={EP.noteContent}>{event.content}</div>
    </>
  );
}
