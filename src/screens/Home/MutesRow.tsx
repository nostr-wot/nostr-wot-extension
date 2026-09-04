import React from 'react';
import { t } from '@lib/i18n.js';
import useRpc from '@hooks/useRpc.ts';
import useRelayCache from '@hooks/useRelayCache.ts';
import { MUTE_LIST_CACHE } from '@services/relayCacheNames.ts';
import ListRow from '@components/ListRow/ListRow';
import { IconShield } from '@assets';
import { useNavigate } from '@context/NavigationContext';
import type { MyMuteList } from '@domain/mutes/muteList.ts';

/**
 * Home-screen module for the user's own NIP-51 mute list (kind:10000). Shows a
 * quick count of muted people + words + hashtags and opens the Mutes manager.
 * The info tooltip explains what the published mute list is.
 */
export default function MutesRow() {
  const navigate = useNavigate();
  // Only the three counts, not the whole list: this row renders a number, and
  // asking for `MyMuteList` would oblige it to carry `rawContent` — the
  // encrypted private half — for no reason.
  const { data, reload } = useRpc<Pick<MyMuteList, 'people' | 'words' | 'hashtags'>>('getMyMuteList', {}, {
    defaultValue: { people: [], words: [], hashtags: [] },
  });
  // The first read comes from the background's cache so this paints without
  // waiting on a relay; this picks up the refreshed answer when it lands.
  useRelayCache(MUTE_LIST_CACHE, reload);
  const count =
    (data?.people?.length || 0) + (data?.words?.length || 0) + (data?.hashtags?.length || 0);

  return (
    <ListRow
      leading={<IconShield size={16} />}
      title={t('mutes.cardTitle')}
      info={t('mutes.cardInfo')}
      subtitle={t('mutes.cardSummary', { count })}
      onClick={navigate.manageFilters}
    />
  );
}
