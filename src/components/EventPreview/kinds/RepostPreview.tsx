import { t } from '@services/i18n/i18n.ts';
import { EP } from '../eventPreviewClasses.ts';

export default function RepostPreview() {
  return (
    <>
      <h3 className={EP.sectionTitle}>{t('event.repost')}</h3>
      <div className={EP.eventNote}>{t('event.repostingNote')}</div>
    </>
  );
}
