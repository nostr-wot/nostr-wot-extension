import { t } from '@services/i18n/i18n.ts';
import Button from '@components/Button';
import EmptyState from '@components/EmptyState';
import WalletSetup from './WalletSetup';
import Wallet from './Wallet';
import { useWallet } from '@context/WalletContext';

import Spinner from '@components/Spinner';
import Container from '@components/Container';

/**
 * Wallet section for the settings menu.
 *
 * Config presence is read once by `WalletContext`, not by this component —
 * see that file for why (it used to be asked again here, again by `Wallet`
 * for the balance, and again by `useWalletBanner` on Home).
 */
export default function WalletSection() {
  const wallet = useWallet();

  if (wallet.configReadFailed && typeof wallet.configType !== 'string') {
    return (
      <EmptyState text={t('wallet.checkFailed')}>
        <Button small onClick={wallet.refreshConfig}>{t('common.retry')}</Button>
      </EmptyState>
    );
  }

  if (wallet.configType === null) {
    return (
      <Container variant="row" className="justify-center py-12">
        <Spinner />
      </Container>
    );
  }

  if (!wallet.configType) {
    return <WalletSetup onConnected={() => wallet.refreshConfig()} />;
  }

  return <Wallet providerType={wallet.configType} onDisconnected={() => wallet.markDisconnected()} />;
}
