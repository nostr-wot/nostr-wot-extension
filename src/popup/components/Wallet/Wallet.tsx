import React, { useState, useEffect, useCallback } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Card from '@components/Card/Card';
import Button from '@components/Button/Button';
import TxFilterDialog from './TxFilterDialog';
import TransactionList from './TransactionList';
import WalletSettings from './WalletSettings';
import DepositDialog from './DepositDialog';
import SendDialog from './SendDialog';
import { IconSettings } from '@assets/index';
import { type Transaction } from '@lib/wallet/types.ts';
import { matchesTxFilter, dateRangeToTs, type TxFilters } from '@shared/txFilter.ts';

import styles from './Wallet.module.css';

interface WalletProps {
  providerType: string;
  onDisconnected: () => void;
}

export default function Wallet({ providerType, onDisconnected }: WalletProps) {
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState<boolean>(true);
  const [balanceError, setBalanceError] = useState<string>('');
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

  const fetchBalance = useCallback(async () => {
    setBalanceLoading(true);
    setBalanceError('');
    try {
      const result = await rpc<{ balance: number }>('wallet_getBalance');
      setBalance(result?.balance ?? 0);
    } catch (e: unknown) {
      setBalanceError((e as Error).message);
    }
    setBalanceLoading(false);
  }, []);

  // Fetches raw pages from the API, accumulating until we have at least
  // `target` results that pass the given filters, or we exhaust the data.
  // For date-from filters, stops early once transactions are older than the boundary.
  const fetchFiltered = useCallback(async (
    startOffset: number,
    existing: Transaction[],
    filters: TxFilters,
    target = 10,
  ) => {
    setTxLoading(true);
    const BATCH = 50;
    const MAX_FETCHED = 500;
    const accumulated = [...existing];
    let offset = startOffset;
    let hasMore = true;
    // Same conversion the renderer uses — this was a third hand-written copy.
    const { fromTs, toTs } = dateRangeToTs(filters);

    try {
      while (hasMore && offset - startOffset < MAX_FETCHED) {
        const page = await rpc<Transaction[]>('wallet_getTransactions', { limit: BATCH, offset });
        if (page.length < BATCH) hasMore = false;
        offset += page.length;

        for (const tx of page) {
          // API returns newest-first; if we've passed the from-date, no more matches possible
          if (fromTs && tx.createdAt < fromTs) { hasMore = false; break; }
          accumulated.push(tx);
        }

        // Count how many match all filters so far. Same predicate the render
        // path uses, so the two cannot disagree about when there is enough.
        const matchCount = accumulated.filter(
          (tx) => matchesTxFilter(tx, filters, { fromTs, toTs }),
        ).length;

        if (matchCount >= target) break;
      }
    } catch { /* non-critical */ }

    setTransactions(accumulated);
    setTxOffset(offset);
    setTxHasMore(hasMore);
    setTxLoading(false);
  }, []);

  // The threshold, NWC URI and Lightning Address moved into WalletSettings —
  // three RPCs on every wallet open for a panel most sessions never touch.
  useEffect(() => {
    fetchBalance();
    fetchFiltered(0, [], { direction: 'all', dateFrom: '', dateTo: '' });
  }, [fetchBalance, fetchFiltered]);

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
        <button className={styles.settingsBtn} onClick={() => setShowSettings(true)} title={t('wallet.settings')}>
          <IconSettings size={16} />
        </button>
        <span className={styles.balanceLabel}>{t('wallet.balance')}</span>
        {balanceLoading ? (
          <div className={styles.loading}>
            <div className={styles.spinner} />
          </div>
        ) : balanceError ? (
          <div className={styles.balanceErrorWrap}>
            <div className={styles.error}>{balanceError}</div>
            <Button small variant="secondary" onClick={fetchBalance}>
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
            fetchBalance();
            fetchFiltered(0, [], { direction: txDirection, dateFrom: txDateFrom, dateTo: txDateTo });
          }}
        />
      )}

      {showSend && (
        <SendDialog
          onClose={() => setShowSend(false)}
          onSent={() => {
            fetchBalance();
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
          onClose={() => { setShowSettings(false); fetchBalance(); }}
          onDisconnected={onDisconnected}
        />
      )}
    </div>
  );
}
