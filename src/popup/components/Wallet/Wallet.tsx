import React, { useState, useEffect, useCallback } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Card from '@components/Card/Card';
import Spinner from '@components/Spinner/Spinner';
import Button from '@components/Button/Button';
import TxFilterDialog from './TxFilterDialog';
import TransactionList from './TransactionList';
import WalletSettings from './WalletSettings';
import DepositDialog from './DepositDialog';
import SendDialog from './SendDialog';
import { IconSettings } from '@assets/index';
import { type Transaction } from '@lib/wallet/types.ts';
import { type TxFilters } from '@shared/txFilter.ts';
import { accumulateTransactions } from '@shared/txPager.ts';
import { useWallet } from '../../context/WalletContext';

import styles from './Wallet.module.css';
import IconButton from '@components/IconButton/IconButton';

interface WalletProps {
  providerType: string;
  onDisconnected: () => void;
}

export default function Wallet({ providerType, onDisconnected }: WalletProps) {
  // Balance and its refresh live in WalletContext now — this used to fetch it
  // again on its own mount, on top of the config check WalletSection already
  // did.
  const { balance, balanceLoading, balanceError, refreshBalance } = useWallet();
  const [showSettings, setShowSettings] = useState<boolean>(false);

  const [showDeposit, setShowDeposit] = useState<boolean>(false);

  const [showSend, setShowSend] = useState<boolean>(false);

  // Transactions
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState<boolean>(true);
  const [txOffset, setTxOffset] = useState<number>(0);
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
    setTxLoading(true);
    const { transactions, offset, hasMore } = await accumulateTransactions({
      fetchPage: (limit, pageOffset) => rpc<Transaction[]>('wallet_getTransactions', { limit, offset: pageOffset }),
      startOffset,
      existing,
      filters,
      target,
    });
    setTransactions(transactions);
    setTxOffset(offset);
    setTxHasMore(hasMore);
    setTxLoading(false);
  }, []);

  // The threshold, NWC URI and Lightning Address moved into WalletSettings —
  // three RPCs on every wallet open for a panel most sessions never touch.
  // Balance is not fetched here: WalletContext already fetches it the moment
  // `configType` becomes a provider string, which happens before this
  // component ever mounts.
  useEffect(() => {
    fetchFiltered(0, [], { direction: 'all', dateFrom: '', dateTo: '' });
  }, [fetchFiltered]);

  const handleShowMore = () => {
    fetchFiltered(txOffset, transactions, { direction: txDirection, dateFrom: txDateFrom, dateTo: txDateTo });
  };

  const applyFilters = (f: TxFilters) => {
    setTxDirection(f.direction);
    setTxDateFrom(f.dateFrom);
    setTxDateTo(f.dateTo);
    setTxFilterOpen(false);
    // Re-fetch: start from scratch with new filters
    fetchFiltered(0, [], f);
  };

  return (
    <div className={styles.section}>
      {/* Balance */}
      <Card className={styles.balanceCard}>
        <IconButton className={styles.settingsBtn} onClick={() => setShowSettings(true)} title={t('wallet.settings')} aria-label={t('wallet.settings')}>
          <IconSettings size={16} />
        </IconButton>
        <span className={styles.balanceLabel}>{t('wallet.balance')}</span>
        {balanceLoading ? (
          <div className={styles.loading}>
            <Spinner />
          </div>
        ) : balanceError ? (
          <div className={styles.balanceErrorWrap}>
            <div className={styles.error}>{balanceError}</div>
            <Button small variant="secondary" onClick={refreshBalance}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <div>
            <span className={styles.balanceValue}>
              {Math.round(balance ?? 0).toLocaleString()}
            </span>
            <span className={styles.balanceUnit}>sats</span>
          </div>
        )}
      </Card>

      {/* Action buttons */}
      <div className={styles.actionRow}>
        <Button onClick={() => setShowDeposit(true)}>{t('wallet.deposit')}</Button>
        <Button variant="secondary" onClick={() => setShowSend(true)}>{t('wallet.send')}</Button>
      </div>

      {showDeposit && (
        <DepositDialog
          onClose={() => setShowDeposit(false)}
          onPaid={() => {
            refreshBalance();
            fetchFiltered(0, [], { direction: txDirection, dateFrom: txDateFrom, dateTo: txDateTo });
          }}
        />
      )}

      {showSend && (
        <SendDialog
          onClose={() => setShowSend(false)}
          onSent={() => {
            refreshBalance();
            fetchFiltered(0, [], { direction: txDirection, dateFrom: txDateFrom, dateTo: txDateTo });
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
        hasMore={txHasMore}
        filters={{ direction: txDirection, dateFrom: txDateFrom, dateTo: txDateTo }}
        onOpenFilters={() => setTxFilterOpen(true)}
        onLoadMore={handleShowMore}
      />

      {/* Settings overlay (full-page) */}
      {showSettings && (
        <WalletSettings
          providerType={providerType}
          onClose={() => { setShowSettings(false); refreshBalance(); }}
          onDisconnected={onDisconnected}
        />
      )}
    </div>
  );
}
