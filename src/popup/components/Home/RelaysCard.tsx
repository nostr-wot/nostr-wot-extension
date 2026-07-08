import React, { useState, useEffect } from 'react';
import browser from '@shared/browser.ts';
import { t } from '@lib/i18n.js';
import { DEFAULT_RELAYS } from '@shared/constants.ts';
import NavRow from '@components/NavRow/NavRow';
import { IconGlobe } from '@assets';

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
    <NavRow
      icon={<IconGlobe size={16} />}
      title={t('network.relays')}
      info={t('network.relaysInfo')}
      subtitle={t('network.relaysSummary', { count })}
      onClick={onOpen}
    />
  );
}
