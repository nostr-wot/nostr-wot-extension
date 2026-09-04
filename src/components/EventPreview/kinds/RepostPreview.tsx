import React from 'react';
import { t } from '@lib/i18n.js';
import { EP } from '../eventPreviewClasses.ts';

export default function RepostPreview() {
  return (
    <>
      <h3 className={EP.sectionTitle}>{t('event.repost')}</h3>
      <div className={EP.eventNote}>{t('event.repostingNote')}</div>
    </>
  );
}
