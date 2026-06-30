import React from 'react';
import { t } from '@lib/i18n.js';
import useRpc from '@shared/hooks/useRpc.js';
import Card from '@components/Card/Card';
import InfoTooltip from '@components/InfoTooltip/InfoTooltip';
import { IconShield, IconChevronRight } from '@assets';
import styles from './HomeTab.module.css';

interface MyMuteList {
  people: string[];
  words: string[];
  hashtags: string[];
}

/**
 * Home-screen module for the user's own NIP-51 mute list (kind:10000). Shows a
 * quick count of muted people + words + hashtags and opens the Mutes manager.
 * The info tooltip explains what the published mute list is.
 */
export default function MutesCard({ onOpen }: { onOpen: () => void }) {
  const { data } = useRpc<MyMuteList>('getMyMuteList', {}, {
    defaultValue: { people: [], words: [], hashtags: [] },
  });
  const count =
    (data?.people?.length || 0) + (data?.words?.length || 0) + (data?.hashtags?.length || 0);

  return (
    <Card className={styles.blocksCard} onClick={onOpen}>
      <IconShield size={16} className={styles.blocksIcon} />
      <div className={styles.blocksText}>
        <strong>
          {t('mutes.cardTitle')}
          <InfoTooltip text={t('mutes.cardInfo')} />
        </strong>
        <span>{t('mutes.cardSummary', { count })}</span>
      </div>
      <IconChevronRight size={16} />
    </Card>
  );
}
