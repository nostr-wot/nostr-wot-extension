import { useState, useMemo, ChangeEvent } from 'react';
import { t } from '@services/i18n/i18n.ts';
import Card from '@components/Card/Card';
import Spinner from '@components/Spinner/Spinner';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import { IconTuner, IconSync, IconDownload } from '@assets/index';
import { formatTxDate } from '@utils/format/time.ts';
import { filterTransactions, countActiveFilters, isPlaceholderMemo, type TxFilters } from '@domain/wallet/txFilter.ts';
import type { Transaction } from '@domain/wallet/types.ts';
import IconButton from '@components/IconButton/IconButton';
import FormError from '@components/FormError/FormError';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

interface TransactionListProps {
  transactions: Transaction[];
  loading: boolean;
  hasMore: boolean;
  error?: string;
  onRefresh: () => void;
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
  transactions, loading, hasMore, filters, onOpenFilters, onLoadMore, error, onRefresh,
}: TransactionListProps) {
  const [search, setSearch] = useState<string>('');

  const visible = useMemo(
    () => filterTransactions(transactions, filters, search),
    [transactions, filters, search],
  );
  const filterCount = countActiveFilters(filters);

  return (
    <Card className="m-0 p-6 shrink-0" aria-busy={loading}>
      <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-heading">{t('wallet.transactions')}</h3>{loading && <span aria-label={t('common.loading')}><Spinner size={14}/></span>}<IconButton tone="brand" aria-label={t('common.refresh')} title={t('common.refresh')} disabled={loading} onClick={onRefresh}><IconSync size={16}/></IconButton></div>
      <Container variant="row" gap={3} className="mb-4">
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
      </Container>

      {error && <div role="alert" className="mb-4"><FormError>{t('wallet.historyFailed')}</FormError><p className="text-xs text-secondary break-words mt-2">{error}</p><Button small variant="secondary" disabled={loading} onClick={onRefresh}>{t('common.retry')}</Button></div>}
      {loading && visible.length === 0 ? (
        <Container variant="row" className="justify-center py-12">
          <Spinner />
        </Container>
      ) : !loading && !error && visible.length === 0 ? (
        <Text variant="muted" as="div" className="text-center py-6">{t(filterCount || search.trim() ? 'wallet.noMatchingTransactions' : 'wallet.noTransactions')}</Text>
      ) : (
        <Container gap="px">
          {visible.map((tx) => (
            <Container key={tx.paymentHash} variant="row" gap={4} className="py-4 border-b border-card-border">
              <span className="flex items-center justify-center w-16 h-16 rounded-md bg-brand-light text-brand shrink-0"><span className={tx.amount < 0 ? 'rotate-180' : ''}><IconDownload size={16}/></span></span>
              <div className="flex-1 min-w-0">
                <Text variant="body" as="div" className="text-sm overflow-hidden text-ellipsis whitespace-nowrap">
                  {isPlaceholderMemo(tx.memo)
                    ? (tx.status === 'pending' ? t('wallet.txRequested') : tx.amount >= 0 ? t('wallet.txReceived') : t('wallet.txSent'))
                    : tx.memo}
                </Text>
                <span className="text-xs text-menu-subtitle">
                  {formatTxDate(tx.createdAt)}{tx.status === 'pending' && <span className="text-brand ml-2">{t('wallet.txPending')}</span>}{tx.status === 'failed' && <span className="text-error ml-2">{t('wallet.txFailed')}</span>}
                </span>
              </div>
              <span className={`text-md font-semibold text-right whitespace-nowrap ${tx.status === 'failed' ? 'text-muted' : 'text-heading'}`}>
                {tx.amount >= 0 && tx.status === 'settled' ? '+' : ''}{Math.round(tx.amount).toLocaleString()}<span className="block text-xs font-normal text-menu-subtitle">sats</span>
              </span>
            </Container>
          ))}
        </Container>
      )}

      {hasMore && !loading && !error && (
        <div className="text-center py-4">
          <Button small variant="secondary" onClick={onLoadMore} disabled={loading}>
            {loading ? t('common.loading') : t('common.showMore')}
          </Button>
        </div>
      )}
    </Card>
  );
}
