import React from 'react';
import { t } from '@lib/i18n.js';
import NavRow from '@components/NavRow/NavRow';
import { IconGlobe } from '@assets';
import { useNavigate } from './NavigationContext';
import { useRelays } from '@popup/context/RelaysContext';

/**
 * Home-screen module for the user's NIP-65 relay list. Shows the relay count
 * and opens the full relay editor (Network section), where read/write relays
 * are added, removed, and health-checked. The info tooltip explains NIP-65.
 *
 * The list comes from RelaysContext, which owns the read and the storage
 * subscription. That matters here: `relays` lives in storage.sync, unlike
 * almost everything else the popup reads, and this row and the relay editor
 * both need to notice the same writes.
 */
export default function RelaysRow() {
  const navigate = useNavigate();
  const { relays } = useRelays();
  const count = relays.length;

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
