import React from 'react';
import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import Modal from '@components/Modal/Modal';
import styles from './PqcSection.module.css';

const GUIDE_URL = 'https://nostr-wot.com/guides/turn-on-post-quantum-keys';

/** The one-shot explainer for the post-quantum panel. */
export default function HowItWorks({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title={t('pqc.howTitle')}
      onClose={onClose}
      zIndex={720}
      footer={<Button onClick={onClose}>{t('common.gotIt')}</Button>}
    >
      <ol className={styles.pqcSteps}>
        <li>{t('pqc.howStep1')}</li>
        <li>{t('pqc.howStep2')}</li>
        <li>{t('pqc.howStep3')}</li>
      </ol>
      <p className={styles.pqcHowLimit}>{t('pqc.howLimit')}</p>
      <a className={styles.pqcCopyLink} href={GUIDE_URL} target="_blank" rel="noreferrer noopener">
        {t('pqc.guideLink')}
      </a>
    </Modal>
  );
}
