import React, { useState, useCallback, useEffect } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import EmptyState from '@components/EmptyState/EmptyState';
import WalletSetup from './WalletSetup';
import Wallet from './Wallet';

import styles from './Wallet.module.css';
import Spinner from '@components/Spinner/Spinner';

/**
 * Wallet section for the settings menu.
 *
 * Checks `wallet_hasConfig` on mount — returns the provider type string
 * (truthy) or false. Shows WalletSetup or Wallet accordingly.
 */
export default function WalletSection() {
  // null = loading, false = no config, string = provider type
  const [configType, setConfigType] = useState<string | false | null>(null);
  const [readFailed, setReadFailed] = useState<boolean>(false);

  const checkConfig = useCallback(async () => {
    setReadFailed(false);
    try {
      const result = await rpc<string | false>('wallet_hasConfig');
      setConfigType(result || false);
    } catch {
      // `false` means "this account has no wallet", which is a claim a failed
      // RPC cannot support — and the consequence is not a wrong label but the
      // whole SETUP FLOW rendered over a wallet that is already connected. A
      // cold service worker was enough to do it. The corrected pattern is three
      // files away in useWalletBanner.
      setReadFailed(true);
    }
  }, []);

  useEffect(() => {
    checkConfig();
  }, [checkConfig]);

  if (readFailed) {
    return (
      <EmptyState text={t('wallet.checkFailed')}>
        <Button small onClick={checkConfig}>{t('common.retry')}</Button>
      </EmptyState>
    );
  }

  if (configType === null) {
    return (
      <div className={styles.loading}>
        <Spinner />
      </div>
    );
  }

  if (!configType) {
    return <WalletSetup onConnected={() => checkConfig()} />;
  }

  return <Wallet providerType={configType} onDisconnected={() => setConfigType(false)} />;
}
