import React from 'react';
import { t } from '@lib/i18n.js';
import useRpc from '@shared/hooks/useRpc.js';
import NavCard from '@components/NavCard/NavCard';
import { IconShield } from '@assets';

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
    <NavCard
      icon={<IconShield size={16} />}
      title={t('mutes.cardTitle')}
      info={t('mutes.cardInfo')}
      subtitle={t('mutes.cardSummary', { count })}
      onClick={onOpen}
    />
  );
}
