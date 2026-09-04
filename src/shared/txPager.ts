/**
 * Paging through the wallet's transaction list until there is enough to show.
 *
 * The API returns pages newest-first and has no server-side filter, so getting
 * "the last 10 outgoing payments" means fetching pages and counting matches
 * client-side until enough have accumulated. That loop was tangled with
 * `setState` calls in Wallet.tsx, which is exactly why it was never tested: no
 * test harness here renders React. Pulled out as a pure function, it takes an
 * injected `fetchPage` and returns what it accumulated instead of setting
 * anything.
 *
 * Reuses `matchesTxFilter`/`dateRangeToTs` from txFilter.ts rather than
 * re-deriving the predicate — see that module's header for the bug that
 * cost: two hand-written copies of one rule, agreeing only by luck.
 */

import { matchesTxFilter, dateRangeToTs, type TxFilters, type FilterableTx } from './txFilter.ts';

export interface AccumulateOptions<T extends FilterableTx> {
  /** Fetches one raw page from the provider; newest transactions first. */
  fetchPage: (limit: number, offset: number) => Promise<T[]>;
  /** Offset to resume from — 0 for a fresh fetch, `result.offset` to page further. */
  startOffset: number;
  /** Rows already accumulated from a previous call, kept ahead of the new page. */
  existing: T[];
  filters: TxFilters;
  /** Stop once this many rows match `filters`. */
  target?: number;
  /** Rows requested per page. A short page (fewer rows than this) means the API is exhausted. */
  batch?: number;
  /** Hard ceiling on rows fetched in this call, regardless of `target`. */
  maxFetched?: number;
}

export interface AccumulateResult<T> {
  transactions: T[];
  offset: number;
  hasMore: boolean;
}

/**
 * Fetch pages, accumulating until `target` matches are found, the API runs
 * out, or `maxFetched` is hit.
 */
export async function accumulateTransactions<T extends FilterableTx>({
  fetchPage,
  startOffset,
  existing,
  filters,
  target = 10,
  batch = 50,
  maxFetched = 500,
}: AccumulateOptions<T>): Promise<AccumulateResult<T>> {
  const accumulated = [...existing];
  let offset = startOffset;
  let hasMore = true;
  // Same conversion the renderer uses — this was a third hand-written copy.
  const range = dateRangeToTs(filters);

  try {
    while (hasMore && offset - startOffset < maxFetched) {
      const page = await fetchPage(batch, offset);
      if (page.length < batch) hasMore = false;
      offset += page.length;

      for (const tx of page) {
        // API returns newest-first; once a row is older than the from-date, no
        // later row in this page (or any further page) can match either.
        if (range.fromTs && tx.createdAt < range.fromTs) { hasMore = false; break; }
        accumulated.push(tx);
      }

      // Count how many match all filters so far. Same predicate the render
      // path uses, so the two cannot disagree about when there is enough.
      const matchCount = accumulated.filter((t) => matchesTxFilter(t, filters, range)).length;
      if (matchCount >= target) break;
    }
  } catch {
    // A page fetch is not the only thing keeping the wallet usable — balance
    // and send still work — so a transient failure mid-page returns what was
    // accumulated so far rather than throwing past the caller's setState and
    // blanking a list that was already partially populated.
  }

  return { transactions: accumulated, offset, hasMore };
}
