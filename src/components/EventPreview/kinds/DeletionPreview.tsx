import React from 'react';
import { t } from '@lib/i18n.js';
import { truncate } from '@utils/format/text.ts';
import type { NostrEventDisplay } from '@models/nostrEvent.ts';
import FieldDisplay from '@components/FieldDisplay/FieldDisplay';
import { EP } from '../eventPreviewClasses.ts';

interface DeletionPreviewProps {
  event: NostrEventDisplay;
}

export default function DeletionPreview({ event }: DeletionPreviewProps) {
  const ids = event.tags?.filter((tag) => tag[0] === 'e').map((tag) => tag[1]) || [];
  return (
    <>
      <h3 className={EP.sectionTitle}>{t('event.eventDeletion')}</h3>
      <FieldDisplay label={t('event.count')} value={t('event.nEvents', { count: ids.length })} />
      {ids.slice(0, 3).map((id) => (
        <FieldDisplay key={id} label={t('event.id')} value={truncate(id, 24)} mono />
      ))}
      {ids.length > 3 && <div className={EP.eventNote}>{t('event.andMore', { count: ids.length - 3 })}</div>}
    </>
  );
}
