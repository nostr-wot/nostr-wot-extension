import React from 'react';
import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import Modal from '@components/Modal/Modal';

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
      <ol className="mb-4 pl-9">
        <li className="mb-3 text-xs leading-loose text-body">{t('pqc.howStep1')}</li>
        <li className="mb-3 text-xs leading-loose text-body">{t('pqc.howStep2')}</li>
        <li className="mb-3 text-xs leading-loose text-body">{t('pqc.howStep3')}</li>
      </ol>
      <p className="mb-4 text-xs leading-loose text-muted">{t('pqc.howLimit')}</p>
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
