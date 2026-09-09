/**
 * The wallet's paged transaction accumulation.
 *
 * This was the subtlest logic in Wallet.tsx and, because it lived inside a
 * `useCallback` tangled with `setState` calls, completely untested. Pulled
 * out to `accumulateTransactions`, it takes an injected `fetchPage` so these
 * tests can drive it with canned pages instead of a real wallet provider.
 *
 * Run with:
 *   node --import tsx --test tests/tx-pager.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { accumulateTransactions } from '../src/domain/wallet/txPager.ts';
import { type TxFilters, type FilterableTx } from '../src/domain/wallet/txFilter.ts';
import { EMPTY_TX_FILTERS } from '@constants/wallet.ts';

const at = (iso: string) => new Date(iso).getTime() / 1000;
const tx = (over: Partial<FilterableTx> = {}): FilterableTx => ({
  amount: 100,
  createdAt: at('2026-03-15T12:00:00Z'),
  ...over,
});
const filters = (over: Partial<TxFilters> = {}): TxFilters => ({ ...EMPTY_TX_FILTERS, ...over });

/** Builds a fixed set of pages and a `fetchPage` that serves them by offset. */
function pagedFetch<T>(pages: T[][]) {
  return async (limit: number, offset: number): Promise<T[]> => {
    const index = offset / limit;
    return pages[index] ?? [];
  };
}

describe('accumulateTransactions — stopping once satisfied', () => {
  it('stops fetching once target matches have accumulated', async () => {
    let calls = 0;
    const fetchPage = async (limit: number, offset: number) => {
      calls++;
      // Every page is full and every row matches, so a fetcher that ignored
      // `target` would keep paging until `maxFetched`.
      return Array.from({ length: limit }, (_, i) => tx({ createdAt: at('2026-03-15T12:00:00Z') - offset - i }));
    };

    const result = await accumulateTransactions({
      fetchPage,
      startOffset: 0,
      existing: [],
      filters: EMPTY_TX_FILTERS,
      target: 5,
      batch: 10,
    });

    assert.equal(calls, 1, 'one full page already has more than 5 matches');
    assert.equal(result.transactions.length, 10, 'the whole page that satisfied target is kept');
    assert.equal(result.hasMore, true);
  });

  it('a short page (fewer than batch) sets hasMore to false', async () => {
    const fetchPage = pagedFetch([[tx(), tx(), tx()]]);
    const result = await accumulateTransactions({
      fetchPage,
      startOffset: 0,
      existing: [],
      filters: EMPTY_TX_FILTERS,
      target: 100,
      batch: 10,
    });

    assert.equal(result.hasMore, false);
    assert.equal(result.transactions.length, 3);
  });
});

describe('accumulateTransactions — date boundary', () => {
  it('stops mid-page and excludes rows older than dateFrom', async () => {
    // Newest-first, as the real API returns them: two rows inside the
    // boundary, then two older rows in the same page.
    const page = [
      tx({ createdAt: at('2026-03-15T12:00:00') }),
      tx({ createdAt: at('2026-03-15T06:00:00') }),
      tx({ createdAt: at('2026-03-14T23:00:00') }),
      tx({ createdAt: at('2026-03-14T01:00:00') }),
    ];
    const fetchPage = pagedFetch([page]);

    const result = await accumulateTransactions({
      fetchPage,
      startOffset: 0,
      existing: [],
      filters: filters({ dateFrom: '2026-03-15' }),
      target: 100,
      batch: 10,
    });

    assert.equal(result.transactions.length, 2, 'rows at or after the boundary only');
    assert.equal(
      result.transactions.every((t) => t.createdAt >= at('2026-03-15T00:00:00')),
      true,
    );
    assert.equal(result.hasMore, false, 'hitting the boundary means nothing further can match');
  });
});

describe('accumulateTransactions — bounds', () => {
  it('never fetches past maxFetched', async () => {
    let calls = 0;
    const fetchPage = async (limit: number) => {
      calls++;
      return Array.from({ length: limit }, () => tx());
    };

    // The guard is checked before each fetch, so the in-flight page when the
    // threshold is crossed still completes: 50, 100, 150 all pass the
    // `< 120` check before that fetch starts, then 150 stops it — three
    // calls, never a fourth.
    const result = await accumulateTransactions({
      fetchPage,
      startOffset: 0,
      existing: [],
      filters: EMPTY_TX_FILTERS,
      target: 1_000_000,
      batch: 50,
      maxFetched: 120,
    });

    assert.equal(calls, 3);
    assert.equal(result.offset, 150);
    assert.equal(result.hasMore, true);
  });

  it('offset advances by rows actually received, not by batch', async () => {
    const page = [tx(), tx(), tx()];
    const fetchPage = pagedFetch([page]);

    const result = await accumulateTransactions({
      fetchPage,
      startOffset: 0,
      existing: [],
      filters: EMPTY_TX_FILTERS,
      target: 100,
      batch: 10,
    });

    assert.equal(result.offset, 3, 'a 3-row page advances the offset by 3, not by the batch size of 10');
  });
});

describe('accumulateTransactions — error handling', () => {
  it('returns what was accumulated so far rather than throwing', async () => {
    // The fetcher swallows a mid-stream error deliberately: balance and send
    // still work without transaction history, so a transient failure should
    // leave the caller with a partial (possibly empty) list, not an unhandled
    // rejection blanking a screen that was already showing data.
    const first = [tx({ memo: 'kept' }), tx({ memo: 'kept' })];
    let calls = 0;
    const fetchPage = async (_limit: number) => {
      calls++;
      if (calls === 1) return first;
      throw new Error('network down');
    };

    const result = await accumulateTransactions({
      fetchPage,
      startOffset: 0,
      existing: [],
      filters: EMPTY_TX_FILTERS,
      target: 100,
      batch: 2,
    });

    assert.equal(result.transactions.length, 2);
    assert.deepEqual(result.transactions, first);
  });

  it('preserves existing rows when the very first fetch fails', async () => {
    const priorRow = tx({ memo: 'from before' });
    const fetchPage = async () => { throw new Error('boom'); };

    const result = await accumulateTransactions({
      fetchPage,
      startOffset: 10,
      existing: [priorRow],
      filters: EMPTY_TX_FILTERS,
    });

    assert.deepEqual(result.transactions, [priorRow]);
    assert.equal(result.offset, 10, 'offset does not advance on a call that never returned a page');
  });
});

 it('continues past unpaid invoice pages and exposes fetch failures for retry', async () => {
   const pending = Array.from({length:50}, () => tx({status:'pending'}));
   const offsets:number[]=[];
   const result = await accumulateTransactions({fetchPage:async (_limit,offset)=>{offsets.push(offset); return offset===0 ? pending : [tx({status:'settled'})];},startOffset:0,existing:[],filters:EMPTY_TX_FILTERS});
   assert.deepEqual(offsets,[0,50]);
   assert.equal(result.offset,51);
   const failed = await accumulateTransactions({fetchPage:async()=>{throw new Error('Offline');},startOffset:0,existing:[],filters:EMPTY_TX_FILTERS});
   assert.equal(failed.error,'Offline');
 });

it('skips more than 500 pending invoices until real history is found', async () => {
 const offsets:number[]=[];
 const result=await accumulateTransactions({fetchPage:async(limit,offset)=>{offsets.push(offset); return offset<600 ? Array.from({length:limit},()=>tx({status:'pending'})) : [tx({status:'settled'})];},startOffset:0,existing:[],filters:EMPTY_TX_FILTERS});
 assert.equal(result.offset,601); assert.equal(result.transactions.length,1); assert.equal(offsets.length,13);
});
it('stops paging when the view becomes stale', async () => {
 let current=true; let calls=0;
 await accumulateTransactions({fetchPage:async()=>{calls++;current=false;return Array.from({length:50},()=>tx({status:'pending'}));},startOffset:0,existing:[],filters:EMPTY_TX_FILTERS,shouldContinue:()=>current});
 assert.equal(calls,1);
});
