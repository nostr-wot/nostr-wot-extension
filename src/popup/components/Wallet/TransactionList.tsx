import React, { useState, useMemo, ChangeEvent } from 'react';
import { t } from '@lib/i18n.js';
import Card from '@components/Card/Card';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import { IconTuner } from '@assets/index';
import { formatTxDate } from '@shared/format/time.ts';
import { filterTransactions, countActiveFilters, isPlaceholderMemo, type TxFilters } from '@shared/txFilter.ts';
import type { Transaction } from '@lib/wallet/types.ts';
import styles from './Wallet.module.css';

interface TransactionListProps {
  transactions: Transaction[];
  loading: boolean;
  hasMore: boolean;
  /** The applied filters — for client-side narrowing and the button's badge. */
  filters: TxFilters;
  onOpenFilters: () => void;
  onLoadMore: () => void;
}

/**
 * The transaction card: search box, filter button, rows, and "show more".
 *
 * `search` lives here because nothing outside this card reads it — the paging
 * fetch narrows on the applied filters only, and search is applied to what has
 * already been accumulated.
 */
export default function TransactionList({
  transactions, loading, hasMore, filters, onOpenFilters, onLoadMore,
}: TransactionListProps) {
  const [search, setSearch] = useState<string>('');

  const visible = useMemo(
    () => filterTransactions(transactions, filters, search),
    [transactions, filters, search],
  );
  const filterCount = countActiveFilters(filters);

  return (
    <Card>
      <div className={styles.txToolbar}>
        <div className={styles.txSearchWrap}>
          <Input
            type="text"
            placeholder={t('wallet.searchTransactions')}
            value={search}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            small
          />
        </div>
        <button
          className={`${styles.txFilterBtn} ${filterCount > 0 ? styles.txFilterBtnActive : ''}`}
          onClick={onOpenFilters}
          title={t('wallet.filtersTitle')}
        >
          <IconTuner size={15} />
          {filterCount > 0 && <span className={styles.txFilterBadge}>{filterCount}</span>}
        </button>
      </div>

      {loading && visible.length === 0 ? (
        <div className={styles.loading}>
          <div className={styles.spinner} />
        </div>
      ) : !loading && visible.length === 0 ? (
        <div className={styles.txEmpty}>{t('wallet.noTransactions')}</div>
      ) : (
        <div className={styles.txList}>
          {visible.map((tx) => (
            <div key={tx.paymentHash} className={styles.txRow}>
              <span className={styles.txIcon}>{tx.amount >= 0 ? '↓' : '↑'}</span>
              <div className={styles.txDetails}>
                <div className={styles.txMemo}>
                  {isPlaceholderMemo(tx.memo)
                    ? (tx.amount >= 0 ? t('wallet.txReceived') : t('wallet.txSent'))
                    : tx.memo}
                </div>
                <button className={styles.txDateBtn} onClick={onOpenFilters}>
                  {formatTxDate(tx.createdAt)}
                </button>
              </div>
              <span className={`${styles.txAmount} ${tx.amount >= 0 ? styles.txIncoming : styles.txOutgoing}`}>
                {tx.amount >= 0 ? '+' : ''}{Math.round(tx.amount).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Paging fetches by filter, not by search, so offering "show more" while
          a search is narrowing the view would load pages the user cannot see. */}
      {hasMore && !loading && !search.trim() && visible.length > 0 && (
        <div className={styles.showMore}>
          <Button small variant="secondary" onClick={onLoadMore} disabled={loading}>
            {loading ? t('common.loading') : t('wallet.showMore')}
          </Button>
        </div>
      )}
    </Card>
  );
}
