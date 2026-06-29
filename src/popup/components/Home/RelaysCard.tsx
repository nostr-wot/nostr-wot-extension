import React, { useState, useEffect } from 'react';
import browser from '@shared/browser.ts';
import { t } from '@lib/i18n.js';
import { DEFAULT_RELAYS } from '@shared/constants.ts';
import Card from '@components/Card/Card';
import InfoTooltip from '@components/InfoTooltip/InfoTooltip';
import { IconGlobe, IconChevronRight } from '@assets';
import styles from './HomeTab.module.css';

/**
 * Home-screen module for the user's NIP-65 relay list. Shows the relay count
 * and opens the full relay editor (Network section), where read/write relays
 * are added, removed, and health-checked. The info tooltip explains NIP-65.
 */
export default function RelaysCard({ onOpen }: { onOpen: () => void }) {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    browser.storage.sync.get(['relays'])
      .then((d: Record<string, unknown>) => {
        const str = (d.relays as string) || DEFAULT_RELAYS;
        setCount(str.split(',').map((s) => s.trim()).filter(Boolean).length);
      })
      .catch(() => {});
  }, []);

  return (
    <Card className={styles.blocksCard} onClick={onOpen}>
      <IconGlobe size={16} className={styles.blocksIcon} />
      <div className={styles.blocksText}>
        <strong>
          {t('network.relays')}
          <InfoTooltip text={t('network.relaysInfo')} />
        </strong>
        <span>{t('network.relaysSummary', { count })}</span>
      </div>
      <IconChevronRight size={16} />
    </Card>
  );
}
