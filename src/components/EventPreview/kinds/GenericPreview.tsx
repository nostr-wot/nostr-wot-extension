import React from 'react';
import { KIND_LABELS } from '@domain/nostr/kindLabels.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import { EP } from '../eventPreviewClasses.ts';

interface GenericPreviewProps {
  event: NostrEventDisplay;
}

export default function GenericPreview({ event }: GenericPreviewProps) {
  const kindLabel = KIND_LABELS[event.kind] || `Kind ${event.kind}`;
  return (
    <>
      <h3 className={EP.sectionTitle}>{kindLabel}</h3>
      {event.content && (
        <div className={EP.noteContent}>{event.content}</div>
      )}
    </>
  );
}
