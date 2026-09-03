import React from 'react';
import { t } from '@lib/i18n.js';
import useRpc from '@shared/hooks/useRpc.ts';
import useRelayCache from '@shared/hooks/useRelayCache.ts';
import { MUTE_LIST_CACHE } from '@shared/relayCacheNames.ts';
import NavRow from '@components/NavRow/NavRow';
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
export default function MutesRow({ onOpen }: { onOpen: () => void }) {
  const { data, reload } = useRpc<MyMuteList>('getMyMuteList', {}, {
    defaultValue: { people: [], words: [], hashtags: [] },
  });
  // The first read comes from the background's cache so this paints without
  // waiting on a relay; this picks up the refreshed answer when it lands.
  useRelayCache(MUTE_LIST_CACHE, reload);
  const count =
    (data?.people?.length || 0) + (data?.words?.length || 0) + (data?.hashtags?.length || 0);

  return (
    <NavRow
      icon={<IconShield size={16} />}
      title={t('mutes.cardTitle')}
      info={t('mutes.cardInfo')}
      subtitle={t('mutes.cardSummary', { count })}
      onClick={onOpen}
    />
  );
}
