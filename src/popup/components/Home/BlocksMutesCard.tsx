import React from 'react';
import { t } from '@lib/i18n.js';
import useRpc from '@shared/hooks/useRpc.js';
import Card from '@components/Card/Card';
import InfoTooltip from '@components/InfoTooltip/InfoTooltip';
import { IconShield, IconChevronRight } from '@assets';
import styles from './HomeTab.module.css';

/**
 * Home-screen module for blocks & mutes. Local blocks are private to this
 * browser; mute lists follow NIP-51. Shows a quick count and opens the full
 * Filters manager. The info tooltip explains the distinction.
 */
export default function BlocksMutesCard({ onOpen }: { onOpen: () => void }) {
  const { data: blocks } = useRpc<unknown[]>('getLocalBlocks', {}, { defaultValue: [] });
  const { data: mutes } = useRpc<unknown[]>('getMuteLists', {}, { defaultValue: [] });
  const blockCount = Array.isArray(blocks) ? blocks.length : 0;
  const muteCount = Array.isArray(mutes) ? mutes.length : 0;

  return (
    <Card className={styles.blocksCard} onClick={onOpen}>
      <IconShield size={16} className={styles.blocksIcon} />
      <div className={styles.blocksText}>
        <strong>
          {t('filters.blocksMutes')}
          <InfoTooltip text={t('filters.blocksMutesInfo')} />
        </strong>
        <span>{t('filters.blocksMutesSummary', { blocks: blockCount, mutes: muteCount })}</span>
      </div>
      <IconChevronRight size={16} />
    </Card>
  );
}
