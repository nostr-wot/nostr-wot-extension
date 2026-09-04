/**
 * The wallet transaction filter.
 *
 * This rule used to exist as two hand-written copies in Wallet.tsx — one
 * deciding when to stop fetching pages, one deciding what to render. They
 * agreed; nothing made them agree. These tests pin the boundaries where they
 * would most plausibly have drifted apart.
 *
 * Run with:
 *   node --import tsx --test tests/tx-filter.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateRangeToTs,
  matchesTxFilter,
  matchesTxSearch,
  filterTransactions,
  countActiveFilters,
  isPlaceholderMemo,
  EMPTY_TX_FILTERS,
  type TxFilters,
  type FilterableTx,
} from '../src/domain/wallet/txFilter.ts';

const at = (iso: string) => new Date(iso).getTime() / 1000;
const tx = (over: Partial<FilterableTx> = {}): FilterableTx => ({
  amount: 100,
  createdAt: at('2026-03-15T12:00:00Z'),
  ...over,
});
const filters = (over: Partial<TxFilters> = {}): TxFilters => ({ ...EMPTY_TX_FILTERS, ...over });

describe('direction', () => {
  it('a zero-amount transaction counts as incoming', () => {
    // The `>= 0` boundary. Both original copies agreed; if one had ever been
    // written as `> 0`, the fetcher and the renderer would disagree about how
    // many rows matched and the list would come up short with no error.
    assert.equal(matchesTxFilter(tx({ amount: 0 }), filters({ direction: 'in' })), true);
    assert.equal(matchesTxFilter(tx({ amount: 0 }), filters({ direction: 'out' })), false);
  });

  it('splits positive and negative', () => {
    assert.equal(matchesTxFilter(tx({ amount: 5 }), filters({ direction: 'in' })), true);
    assert.equal(matchesTxFilter(tx({ amount: -5 }), filters({ direction: 'in' })), false);
    assert.equal(matchesTxFilter(tx({ amount: -5 }), filters({ direction: 'out' })), true);
  });

  it('"all" passes everything', () => {
    for (const amount of [-5, 0, 5]) {
      assert.equal(matchesTxFilter(tx({ amount }), filters()), true);
    }
  });
});

describe('date range', () => {
  it('dateTo covers the whole day, not just midnight', () => {
    // Picking the same day at both ends must match that day's transactions.
    // Without the T23:59:59 push it matches only a transaction at exactly
    // 00:00:00, which reads to the user as "today has nothing in it".
    const f = filters({ dateFrom: '2026-03-15', dateTo: '2026-03-15' });
    assert.equal(matchesTxFilter(tx({ createdAt: at('2026-03-15T12:00:00') }), f), true);
    assert.equal(matchesTxFilter(tx({ createdAt: at('2026-03-15T23:59:00') }), f), true);
    assert.equal(matchesTxFilter(tx({ createdAt: at('2026-03-16T00:30:00') }), f), false);
  });

  it('excludes transactions before dateFrom', () => {
    const f = filters({ dateFrom: '2026-03-15' });
    assert.equal(matchesTxFilter(tx({ createdAt: at('2026-03-14T23:00:00') }), f), false);
    assert.equal(matchesTxFilter(tx({ createdAt: at('2026-03-15T01:00:00') }), f), true);
  });

  it('an unset range is unbounded', () => {
    const { fromTs, toTs } = dateRangeToTs(EMPTY_TX_FILTERS);
    assert.equal(fromTs, 0);
    assert.equal(toTs, Infinity);
  });
});

describe('search', () => {
  it('matches the memo case-insensitively', () => {
    assert.equal(matchesTxSearch(tx({ memo: 'Coffee Money' }), 'coffee'), true);
    assert.equal(matchesTxSearch(tx({ memo: 'Coffee' }), 'tea'), false);
  });

  it('matches the absolute amount, which is what the row shows', () => {
    // The row renders "1500", not "-1500", so searching 1500 must find it.
    assert.equal(matchesTxSearch(tx({ amount: -1500, memo: null }), '1500'), true);
  });

  it('an empty or whitespace query matches everything', () => {
    assert.equal(matchesTxSearch(tx({ memo: null }), ''), true);
    assert.equal(matchesTxSearch(tx({ memo: null }), '   '), true);
  });

  it('a missing memo does not throw', () => {
    assert.equal(matchesTxSearch(tx({ memo: undefined }), 'x'), false);
  });
});

describe('filterTransactions', () => {
  const list = [
    tx({ amount: 100, createdAt: at('2026-03-15T10:00:00'), memo: 'zap' }),
    tx({ amount: -50, createdAt: at('2026-03-16T10:00:00'), memo: 'coffee' }),
    tx({ amount: 0, createdAt: at('2026-03-17T10:00:00'), memo: null }),
  ];

  it('applies direction, range and search together', () => {
    assert.equal(filterTransactions(list, filters({ direction: 'out' })).length, 1);
    assert.equal(filterTransactions(list, filters({ dateFrom: '2026-03-16' })).length, 2);
    assert.equal(filterTransactions(list, filters(), 'coffee').length, 1);
    assert.equal(filterTransactions(list, filters({ direction: 'in' }), 'zap').length, 1);
  });

  it('returns everything when nothing is set', () => {
    assert.equal(filterTransactions(list, EMPTY_TX_FILTERS).length, 3);
  });
});

describe('isPlaceholderMemo', () => {
  it('treats provider boilerplate as no memo at all', () => {
    for (const m of ['Lightning Address', 'lightning address', 'lightning  wallet', 'LIGHTNING WALLET']) {
      assert.equal(isPlaceholderMemo(m), true, `${JSON.stringify(m)} is boilerplate`);
    }
    assert.equal(isPlaceholderMemo(''), true);
    assert.equal(isPlaceholderMemo(null), true);
    assert.equal(isPlaceholderMemo(undefined), true);
  });

  it('never swallows a memo a person actually typed', () => {
    // The anchors matter: without them "Lightning Address for coffee" would be
    // classed as boilerplate and the user's own words replaced by "Sent".
    for (const m of ['Coffee', 'lightning address for coffee', 'my lightning wallet', 'wallet']) {
      assert.equal(isPlaceholderMemo(m), false, `${JSON.stringify(m)} is a real memo`);
    }
  });
});

describe('countActiveFilters', () => {
  it('counts only what narrows the list', () => {
    assert.equal(countActiveFilters(EMPTY_TX_FILTERS), 0);
    assert.equal(countActiveFilters(filters({ direction: 'in' })), 1);
    assert.equal(
      countActiveFilters(filters({ direction: 'in', dateFrom: '2026-03-01', dateTo: '2026-03-31' })),
      3,
    );
  });
});
