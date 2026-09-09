import { PQC_GUIDE_URL as GUIDE_URL } from '@constants/pqc.ts';
import { t } from '@services/i18n/i18n.ts';
import Button from '@components/Button';
import Modal from '@components/Modal';
import Text from '@components/Text';

/** The one-shot explainer for the post-quantum panel. */
export default function HowItWorks({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title={t('pqc.howTitle')}
      onClose={onClose}
      zIndex={720}
      footer={<Button onClick={onClose}>{t('common.gotIt')}</Button>}
    >
      <ol className="mb-4 pl-9">
        <Text variant="body" as="li" className="text-sm leading-loose mb-6">{t('pqc.howStep1')}</Text>
        <Text variant="body" as="li" className="text-sm leading-loose mb-6">{t('pqc.howStep2')}</Text>
        <Text variant="body" as="li" className="text-sm leading-loose mb-6">{t('pqc.howStep3')}</Text>
      </ol>
      <Text variant="secondary" as="p" className="text-sm leading-loose mb-4">{t('pqc.howLimit')}</Text>
      <a
        className="inline-flex items-center gap-2.5 mt-5 text-xs text-muted cursor-pointer hover:text-brand"
        href={GUIDE_URL}
        target="_blank"
        rel="noreferrer noopener"
      >
        {t('pqc.guideLink')}
      </a>
    </Modal>
  );
}
