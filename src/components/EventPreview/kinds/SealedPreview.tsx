import { t } from '@services/i18n/i18n.ts';
import { EP } from '../eventPreviewClasses.ts';

export default function SealedPreview() {
  return (
    <>
      <h3 className={EP.sectionTitle}>{t('event.sealedMessage')}</h3>
      <div className={EP.eventNote}>{t('event.sealedDesc')}</div>
    </>
  );
}
