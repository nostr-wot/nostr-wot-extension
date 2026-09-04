import { useState, useMemo, ChangeEvent } from 'react';
import { t } from '@lib/i18n.js';
import Card from '@components/Card/Card';
import Spinner from '@components/Spinner/Spinner';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import { IconTuner } from '@assets/index';
import { formatTxDate } from '@utils/format/time.ts';
import { filterTransactions, countActiveFilters, isPlaceholderMemo, type TxFilters } from '@domain/wallet/txFilter.ts';
import type { Transaction } from '@lib/wallet/types.ts';
import LinkButton from '@components/LinkButton/LinkButton';

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
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 min-w-0">
          <Input
            type="text"
            placeholder={t('wallet.searchTransactions')}
            value={search}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            small
          />
        </div>
        {/* Not IconButton: that component is chromeless at rest by design, but
            this control always shows a border so it reads as a filter toggle
            rather than a hover-only affordance, and it carries an
            active/applied state IconButton's fixed `tone` does not model. */}
        <button
          className={`relative flex items-center justify-center w-15 h-15 rounded-md border transition-all shrink-0 ${
            filterCount > 0
              ? 'border-brand bg-brand-tint-active text-brand'
              : 'border-card-border bg-transparent text-secondary hover:bg-brand-tint-hover hover:text-heading'
          }`}
          onClick={onOpenFilters}
          title={t('wallet.filtersTitle')}
        >
          <IconTuner size={15} />
          {filterCount > 0 && (
            <span className="absolute -top-2.5 -right-2.5 min-w-7 h-7 px-1.5 rounded-[7px] bg-brand text-on-brand text-[9px] font-bold flex items-center justify-center leading-none">
              {filterCount}
            </span>
          )}
        </button>
      </div>

      {loading && visible.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      ) : !loading && visible.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted">{t('wallet.noTransactions')}</div>
      ) : (
        <div className="flex flex-col gap-px">
          {visible.map((tx) => (
            <div key={tx.paymentHash} className="flex items-center gap-4 py-4 border-b border-card-border">
              <span className="text-lg shrink-0">{tx.amount >= 0 ? '↓' : '↑'}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-body overflow-hidden text-ellipsis whitespace-nowrap">
                  {isPlaceholderMemo(tx.memo)
                    ? (tx.amount >= 0 ? t('wallet.txReceived') : t('wallet.txSent'))
                    : tx.memo}
                </div>
                <LinkButton className="text-xs text-secondary hover:text-brand" onClick={onOpenFilters}>
                  {formatTxDate(tx.createdAt)}
                </LinkButton>
              </div>
              <span className={`text-md font-semibold text-right whitespace-nowrap ${tx.amount >= 0 ? 'text-success' : 'text-secondary'}`}>
                {tx.amount >= 0 ? '+' : ''}{Math.round(tx.amount).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Paging fetches by filter, not by search, so offering "show more" while
          a search is narrowing the view would load pages the user cannot see. */}
      {hasMore && !loading && !search.trim() && visible.length > 0 && (
        <div className="text-center py-4">
          <Button small variant="secondary" onClick={onLoadMore} disabled={loading}>
            {loading ? t('common.loading') : t('common.showMore')}
          </Button>
        </div>
      )}
    </Card>
  );
}
