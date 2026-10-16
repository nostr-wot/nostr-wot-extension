import useWalletDisconnect from '@hooks/useWalletDisconnect';
import useStorageWatch from '@hooks/useStorageWatch';
import { LOCK_STATE_KEY } from '@constants/vault.ts';
import { useState, useEffect, useCallback, useRef } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import Card from '@components/Card';
import LinkButton from '@components/LinkButton';
import Text from '@components/Text';
import WalletBalance from '@components/WalletBalance';
import { ButtonSecondary } from '@components/Button';
import TxFilterDialog from './TxFilterDialog';
import TransactionList from './TransactionList';
import WalletSettings from './WalletSettings';
import DepositDialog from './DepositDialog';
import SendDialog from './SendDialog';
import IconSettings from '@assets/IconSettings.tsx';
import IconArrowDownLeft from '@assets/IconArrowDownLeft.tsx';
import IconArrowUpRight from '@assets/IconArrowUpRight.tsx';
import IconLogout from '@assets/IconLogout.tsx';
import ConfirmDialog from '@components/ConfirmDialog';
import IconButton from '@components/IconButton';
import { type Transaction } from '@domain/wallet/types.ts';
import { filterTransactions, type TxFilters } from '@domain/wallet/txFilter.ts';
import { accumulateTransactions } from '@domain/wallet/txPager.ts';
import { useWallet } from '@context/WalletContext';

import FormError from '@components/FormError';
import Container from '@components/Container';

interface WalletProps {
  providerType: string;
  onDisconnected: () => void;
}

export default function Wallet({ providerType, onDisconnected }: WalletProps) {
  // Balance and its refresh live in WalletContext now — this used to fetch it
  // again on its own mount, on top of the config check WalletSection already
  // did.
  const { settings, settingsLoading, settingsError, ensureSettings, refreshSettings, balance, balanceLoading, balanceError, refreshBalance, cachedTransactions, configLoading, configReadFailed, refreshConfig } = useWallet();
  const [settingsSection, setSettingsSection] = useState<'address' | undefined>();
  useEffect(() => { ensureSettings(); }, [ensureSettings]);
  const { disconnect, disconnecting, disconnectError } = useWalletDisconnect(onDisconnected);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  const [showDeposit, setShowDeposit] = useState<boolean>(false);

  const [showSend, setShowSend] = useState<boolean>(false);

  const [confirmDisconnect, setConfirmDisconnect] = useState<boolean>(false);


  // Transactions
  const [transactions, setTransactions] = useState<Transaction[]>(cachedTransactions);
  const txRun = useRef(0);
  const [txError, setTxError] = useState('');
  const [txLoading, setTxLoading] = useState<boolean>(true);
  const [txOffset, setTxOffset] = useState<number>(cachedTransactions.length);
  const [txHasMore, setTxHasMore] = useState<boolean>(true);
  const [txDirection, setTxDirection] = useState<'all' | 'in' | 'out'>('all');
  const [txDateFrom, setTxDateFrom] = useState<string>('');
  const [txDateTo, setTxDateTo] = useState<string>('');
  const [txFilterOpen, setTxFilterOpen] = useState<boolean>(false);

  // Pages the API, accumulating until enough matches exist or the data runs
  // out. The pure half — what to fetch and when to stop — lives in
  // txPager.ts, tested there; this is just wiring it to component state.
  const fetchFiltered = useCallback(async (
    startOffset: number,
    existing: Transaction[],
    filters: TxFilters,
    target = 10,
  ) => {
    const run = ++txRun.current;
    setTxLoading(true);
    setTxError('');
    const { transactions, offset, hasMore, error } = await accumulateTransactions({
      fetchPage: (limit, pageOffset) => rpc<Transaction[]>('wallet_getTransactions', { limit, offset: pageOffset }),
      startOffset,
      existing,
      filters,
      target,
      shouldContinue: () => run === txRun.current,
    });
    if (run !== txRun.current) return;
    setTxError(error || '');
    if (!error || transactions.length > 0) {
      setTransactions(transactions);
      setTxOffset(offset);
      setTxHasMore(hasMore);
    }
    setTxLoading(false);
  }, []);

  // Address and settings share the account cache; opening settings reuses these reads.
  // Balance is not fetched here: WalletContext already fetches it the moment
  // `configType` becomes a provider string, which happens before this
  // component ever mounts.
  useEffect(() => {
    void fetchFiltered(0, [], { direction: 'all', dateFrom: '', dateTo: '' });
    const runs = txRun;
    return () => { runs.current++; };
  }, [fetchFiltered]);

  useStorageWatch([{ area: 'local', keys: [LOCK_STATE_KEY] }], () => {
    txRun.current++;
    setTransactions([]);
    void fetchFiltered(0, [], { direction: txDirection, dateFrom: txDateFrom, dateTo: txDateTo });
  });

  const handleShowMore = () => {
    const filters = { direction: txDirection, dateFrom: txDateFrom, dateTo: txDateTo };
    void fetchFiltered(txOffset, transactions, filters, filterTransactions(transactions, filters).length + 10);
  };

  const applyFilters = (f: TxFilters) => {
    setTxDirection(f.direction);
    setTxDateFrom(f.dateFrom);
    setTxDateTo(f.dateTo);
    setTxFilterOpen(false);
    // Re-fetch: start from scratch with new filters
    void fetchFiltered(0, [], f);
  };

  return (
    <Container gap={4} className="flex-1 min-h-0 overflow-y-auto py-2">
      {/* Balance */}
      <Card className="m-0 p-6 shrink-0 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            {settings.address ? <Text variant="secondary" className="break-all">{settings.address}</Text>
              : providerType === 'lnbits' && settings.address === null ? <LinkButton tone="brand" onClick={() => { setSettingsSection('address'); setShowSettings(true); }}>{t('wallet.setupAlias')}</LinkButton>
              : providerType === 'lnbits' ? <Text variant="muted">{t(settingsLoading ? 'common.loading' : 'wallet.checkFailed')}</Text> : null}
          </div>
        </div>
        <WalletBalance balance={balance} loading={balanceLoading || configLoading} error={!!balanceError || configReadFailed} />
        {(balanceError || configReadFailed) && <div className="text-xs">
          <FormError>{balanceError || t('wallet.checkFailed')}</FormError>
          <ButtonSecondary small onClick={() => { void refreshConfig(); void refreshBalance(); }}>{t('common.retry')}</ButtonSecondary>
        </div>}
      </Card>

      {/* Action buttons */}
      <Container variant="row" gap={4} className="justify-center shrink-0">
        <IconButton size="large" framed tone="brand" tooltip={t('wallet.receive')} onClick={() => { ensureSettings(); setShowDeposit(true); }}>
          <IconArrowDownLeft />
        </IconButton>
        <IconButton size="large" framed tone="brand" tooltip={t('wallet.send')} onClick={() => setShowSend(true)}>
          <IconArrowUpRight />
        </IconButton>
        <IconButton size="large" framed tone="brand" tooltip={t('wallet.settings')} onClick={() => { setSettingsSection(undefined); setShowSettings(true); }}>
          <IconSettings />
        </IconButton>
        <IconButton size="large" framed tone="error" tooltip={t('common.disconnect')} disabled={disconnecting} onClick={() => setConfirmDisconnect(true)}>
          <IconLogout />
        </IconButton>
      </Container>

      {confirmDisconnect && (
        <ConfirmDialog
          title={t('common.disconnect')}
          message={t('wallet.disconnectHint')}
          confirmLabel={t('common.disconnect')}
          danger
          busy={disconnecting}
          error={disconnectError}
          onConfirm={() => { void disconnect(); }}
          onCancel={() => setConfirmDisconnect(false)}
        />
      )}

      {showDeposit && (
        <DepositDialog
          address={settings.address} addressLoading={settingsLoading}
          addressError={settingsError} onRetryAddress={refreshSettings}
          onClose={() => setShowDeposit(false)}
          onPaid={() => {
            void refreshBalance();
            void fetchFiltered(0, [], { direction: txDirection, dateFrom: txDateFrom, dateTo: txDateTo });
          }}
        />
      )}

      {showSend && (
        <SendDialog
          onClose={() => setShowSend(false)}
          onSent={() => {
            void refreshBalance();
            void fetchFiltered(0, [], { direction: txDirection, dateFrom: txDateFrom, dateTo: txDateTo });
          }}
        />
      )}

      {txFilterOpen && (
        <TxFilterDialog
          initial={{ direction: txDirection, dateFrom: txDateFrom, dateTo: txDateTo }}
          onApply={applyFilters}
          onClose={() => setTxFilterOpen(false)}
        />
      )}

      <TransactionList
        transactions={transactions}
        loading={txLoading}
        error={txError}
        onRefresh={() => { void refreshBalance(); void fetchFiltered(0, [], {direction:txDirection,dateFrom:txDateFrom,dateTo:txDateTo}); }}
        hasMore={txHasMore}
        filters={{ direction: txDirection, dateFrom: txDateFrom, dateTo: txDateTo }}
        onOpenFilters={() => setTxFilterOpen(true)}
        onLoadMore={handleShowMore}
      />

      {/* Settings overlay (full-page) */}
      {showSettings && (
        <WalletSettings
          providerType={providerType}
          initialSection={settingsSection}
          onClose={() => { setShowSettings(false); void refreshBalance(); }}
          onDisconnected={onDisconnected}
        />
      )}
    </Container>
  );
}
