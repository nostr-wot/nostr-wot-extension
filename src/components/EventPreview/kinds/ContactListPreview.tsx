import React from 'react';
import { t } from '@lib/i18n.js';
import type { NostrEventDisplay } from '@models/nostrEvent.ts';
import FieldDisplay from '@components/FieldDisplay/FieldDisplay';
import styles from '../EventPreview.module.css';

interface ContactListPreviewProps {
  event: NostrEventDisplay;
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
