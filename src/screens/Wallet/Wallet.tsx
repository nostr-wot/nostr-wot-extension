import useStorageWatch from '@hooks/useStorageWatch';
import { LOCK_STATE_KEY } from '@constants/vault.ts';
import { useState, useEffect, useCallback, useRef } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import Card from '@components/Card';
import WalletBalance from '@components/WalletBalance';
import Button, { ButtonSecondary } from '@components/Button';
import TxFilterDialog from './TxFilterDialog';
import TransactionList from './TransactionList';
import WalletSettings from './WalletSettings';
import DepositDialog from './DepositDialog';
import SendDialog from './SendDialog';
import IconSettings from '@assets/IconSettings.tsx';
import { type Transaction } from '@domain/wallet/types.ts';
import { filterTransactions, type TxFilters } from '@domain/wallet/txFilter.ts';
import { accumulateTransactions } from '@domain/wallet/txPager.ts';
import { useWallet } from '@context/WalletContext';

import IconButton from '@components/IconButton';
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
  const { balance, balanceLoading, balanceError, refreshBalance, cachedTransactions, configLoading, configReadFailed, refreshConfig } = useWallet();
  const [showSettings, setShowSettings] = useState<boolean>(false);

  const [showDeposit, setShowDeposit] = useState<boolean>(false);

  const [showSend, setShowSend] = useState<boolean>(false);

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

  // The threshold, NWC URI and Lightning Address moved into WalletSettings —
  // three RPCs on every wallet open for a panel most sessions never touch.
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
          <div><span className="text-sm font-semibold text-heading">{t('wallet.balance')}</span><p className="text-xs text-menu-subtitle mt-1">{providerType === 'lnbits' ? 'LNbits · Lightning' : 'NWC · Lightning'}</p></div>
        <IconButton tone="brand" onClick={() => setShowSettings(true)} title={t('wallet.settings')} aria-label={t('wallet.settings')}>
          <IconSettings size={16} />
        </IconButton>
        </div>
        <WalletBalance balance={balance} loading={balanceLoading || configLoading} error={!!balanceError || configReadFailed} />
        {(balanceError || configReadFailed) && <div className="text-xs">
          <FormError>{balanceError || t('wallet.checkFailed')}</FormError>
          <ButtonSecondary small onClick={() => { void refreshConfig(); void refreshBalance(); }}>{t('common.retry')}</ButtonSecondary>
        </div>}
      {/* Action buttons */}
      <Container variant="row" gap={4}>
        <Button className="flex-1" onClick={() => setShowDeposit(true)}>{t('wallet.deposit')}</Button>
        <ButtonSecondary className="flex-1" onClick={() => setShowSend(true)}>{t('wallet.send')}</ButtonSecondary>
      </Container>
      </Card>

      {showDeposit && (
        <DepositDialog
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
          onClose={() => { setShowSettings(false); void refreshBalance(); }}
          onDisconnected={onDisconnected}
        />
      )}
    </Container>
  );
}
