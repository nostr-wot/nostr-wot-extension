import { t } from '@services/i18n/i18n.ts';
import useRpc from '@hooks/useRpc.ts';
import useRelayCache from '@hooks/useRelayCache.ts';
import { MUTE_LIST_CACHE } from '@constants/relays.ts';
import ListRow from '@components/ListRow/ListRow';
import IconShield from '@assets/IconShield.tsx';
import { useNavigate } from '@context/NavigationContext';
import { muteListState, type MuteListRead } from '@domain/mutes/muteList.ts';

/**
 * Home-screen module for the user's own NIP-51 mute list (kind:10000). Shows a
 * quick count of muted people + words + hashtags and opens the Mutes manager.
 * The info tooltip explains what the published mute list is.
 */
export default function MutesRow() {
  const navigate = useNavigate();
  const { data, error, reload } = useRpc<MuteListRead>('getMyMuteList');
  const state = error ? 'unavailable' : muteListState(data);
  // The first read comes from the background's cache so this paints without
  // waiting on a relay; this picks up the refreshed answer when it lands.
  useRelayCache(MUTE_LIST_CACHE, reload);
  const count =
    (data?.people?.length || 0) + (data?.words?.length || 0) + (data?.hashtags?.length || 0) + (data?.events?.length || 0);

  return (
    <ListRow
      leading={<IconShield size={16} />}
      title={t('mutes.cardTitle')}
      info={t('mutes.cardInfo')}
      subtitle={state === 'loading' ? t('common.loading')
        : state === 'unavailable' ? t('mutes.failedFetch')
        : state === 'missing' ? t('mutes.notPublished')
        : state === 'private' ? t('mutes.privateSummary')
        : t('mutes.cardSummary', { count })}
      onClick={navigate.manageFilters}
    />
  );
}
