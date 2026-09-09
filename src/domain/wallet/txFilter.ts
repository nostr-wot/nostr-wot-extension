export { EMPTY_TX_FILTERS } from '@constants/wallet.ts';
/**
 * Which wallet transactions match the filter bar.
 *
 * The rule was written twice in Wallet.tsx — once inside the paging loop, to
 * decide whether enough matches had accumulated to stop fetching, and once over
 * the accumulated list, to decide what to render. Two hand-written copies of one
 * predicate: a tweak to either (say, counting a zero-amount row as outgoing)
 * silently makes the fetcher stop at a different point than the renderer draws,
 * and the list quietly comes up short.
 */

export interface TxFilters {
  direction: 'all' | 'in' | 'out';
  dateFrom: string;
  dateTo: string;
}

/** Just the fields the filter reads, so this stays testable without the wallet. */
export interface FilterableTx {
  amount: number;
  createdAt: number;
  memo?: string | null;
  status?: string;
}

/**
 * The date inputs are `YYYY-MM-DD`; transactions carry epoch seconds.
 *
 * `dateTo` is pushed to the end of its day. Without that, picking the same day
 * for both ends matches only transactions at exactly midnight — an empty list
 * for what reads like "just today".
 */
export function dateRangeToTs(filters: TxFilters): { fromTs: number; toTs: number } {
  return {
    fromTs: filters.dateFrom ? new Date(filters.dateFrom).getTime() / 1000 : 0,
    toTs: filters.dateTo ? new Date(`${filters.dateTo}T23:59:59`).getTime() / 1000 : Infinity,
  };
}

/**
 * A zero-amount transaction counts as incoming, matching `amount >= 0`. Both
 * original copies agreed on this; the test pins it so they cannot stop agreeing.
 */
export function matchesTxFilter(
  tx: FilterableTx,
  filters: TxFilters,
  range = dateRangeToTs(filters),
): boolean {
  if (tx.status === 'pending') return false;
  if (filters.direction === 'in' && tx.amount < 0) return false;
  if (filters.direction === 'out' && tx.amount >= 0) return false;
  if (range.fromTs && tx.createdAt < range.fromTs) return false;
  if (range.toTs !== Infinity && tx.createdAt > range.toTs) return false;
  return true;
}

/** Free-text search over the memo and the absolute amount, as shown in the row. */
export function matchesTxSearch(tx: FilterableTx, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return !!tx.memo?.toLowerCase().includes(q) || String(Math.abs(tx.amount)).includes(q);
}

export function filterTransactions<T extends FilterableTx>(
  list: T[],
  filters: TxFilters,
  search = '',
): T[] {
  const range = dateRangeToTs(filters);
  return list.filter((tx) => matchesTxFilter(tx, filters, range) && matchesTxSearch(tx, search));
}

/**
 * Whether a memo is boilerplate the provider filled in rather than something a
 * human wrote.
 *
 * LNbits and friends stamp "Lightning Address" or "lightning wallet" on rows
 * that have no real description. Showing that verbatim makes every row look
 * identical, so the UI substitutes a plain "Received"/"Sent" — but only for
 * these, because a memo a person actually typed must never be swallowed.
 */
export function isPlaceholderMemo(memo: string | null | undefined): boolean {
  return !memo || /^lightning\s*(address|wallet)$/i.test(memo);
}

/** How many filters are actually narrowing anything — drives the badge on the button. */
export function countActiveFilters(filters: TxFilters): number {
  return (
    (filters.direction !== 'all' ? 1 : 0) +
    (filters.dateFrom ? 1 : 0) +
    (filters.dateTo ? 1 : 0)
  );
}
