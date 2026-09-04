import React from 'react';
import { t } from '@lib/i18n.js';
import useBrowserStorage from '@shared/hooks/useBrowserStorage.ts';
import { DEFAULT_RELAYS } from '@shared/constants.ts';
import NavRow from '@components/NavRow/NavRow';
import { IconGlobe } from '@assets';
import { useNavigate } from './NavigationContext';

/**
 * Home-screen module for the user's NIP-65 relay list. Shows the relay count
 * and opens the full relay editor (Network section), where read/write relays
 * are added, removed, and health-checked. The info tooltip explains NIP-65.
 *
 * `relays` lives in storage.sync, unlike almost everything else the popup
 * reads — pass that area explicitly, or the relay editor writing the list
 * goes unnoticed and this card keeps showing its mount-time count.
 */
export default function RelaysRow() {
  const navigate = useNavigate();
  const relays = useBrowserStorage('relays', DEFAULT_RELAYS, 'sync');
  const count = relays.split(',').map((s) => s.trim()).filter(Boolean).length;

  return (
    <NavRow
      icon={<IconGlobe size={16} />}
      title={t('network.relays')}
      info={t('network.relaysInfo')}
      subtitle={t('network.relaysSummary', { count })}
      onClick={navigate.openRelays}
    />
  );
}
