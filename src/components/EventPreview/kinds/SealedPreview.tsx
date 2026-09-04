import { t } from '@lib/i18n.js';
import { EP } from '../eventPreviewClasses.ts';

export default function SealedPreview() {
  return (
    <>
      <h3 className={EP.sectionTitle}>{t('event.sealedMessage')}</h3>
      <div className={EP.eventNote}>{t('event.sealedDesc')}</div>
    </>
  );
}
