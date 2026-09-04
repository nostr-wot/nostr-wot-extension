import React from 'react';
import { t } from '@lib/i18n.js';
import { IconCopy } from '@assets';
import useCopy from '@hooks/useCopy.ts';
import { truncateMiddle } from '@shared/format/text.ts';
import styles from './PqcSection.module.css';

/** Label, shortened value, copy. Shortened in the MIDDLE so both ends stay
 *  checkable and the row stays one line. */
export default function KeyRow({ label, value }: { label: string; value: string }) {
  const { copy, copied, failed } = useCopy();
  return (
    <div className={styles.pqcKeyRow}>
      <span>{label}</span>
      <code title={value}>{truncateMiddle(value, 12, 10)}</code>
      {/* Not IconButton (icon-only, fixed square) or LinkButton (chromeless
          text, no hover surface): this pairs an icon with a conditional
          "Copied"/"Error" label inside a padded hover-background pill, a
          combination neither primitive's contract covers. */}
      <button
        className={styles.pqcKeyCopy}
        onClick={() => copy(value)}
        aria-label={t('common.copy')}
        title={t('common.copy')}
      >
        <IconCopy size={12} />
        {copied ? t('common.copied') : failed ? t('common.error') : ''}
      </button>
    </div>
  );
}
