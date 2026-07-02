import React from 'react';
import { t } from '@lib/i18n.js';
import FieldDisplay from '@components/FieldDisplay/FieldDisplay';
import styles from '../EventPreview.module.css';

interface NostrEvent {
  kind: number;
  content: string;
  tags?: string[][];
  [key: string]: unknown;
}

interface ContactListPreviewProps {
  event: NostrEvent;
}

export default function ContactListPreview({ event }: ContactListPreviewProps) {
  const count = event.tags?.filter((tag) => tag[0] === 'p').length || 0;
  return (
    <>
      <h3 className={styles.sectionTitle}>{t('event.contactList')}</h3>
      <FieldDisplay label={t('event.contacts')} value={t('event.nEntries', { count })} />
    </>
  );
}
