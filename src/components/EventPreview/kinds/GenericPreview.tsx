import React from 'react';
import { KIND_LABELS } from '@shared/constants.ts';
import type { NostrEventDisplay } from '@models/nostrEvent.ts';
import styles from '../EventPreview.module.css';

interface GenericPreviewProps {
  event: NostrEventDisplay;
}

export default function GenericPreview({ event }: GenericPreviewProps) {
  const kindLabel = KIND_LABELS[event.kind] || `Kind ${event.kind}`;
  return (
    <>
      <h3 className={styles.sectionTitle}>{kindLabel}</h3>
      {event.content && (
        <div className={styles.noteContent}>{event.content}</div>
      )}
    </>
  );
}
