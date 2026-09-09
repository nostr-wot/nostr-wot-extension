/**
 * The background's cached-first relay reads.
 *
 * The property that makes caching safe here: an unreachable read is never
 * cached and never evicts a real answer. A cached value is therefore always
 * something the relays genuinely said — stale at worst, never invented. Without
 * that, a flaky-relay day would persist "not published" for a user whose
 * post-quantum attestation is live, and the panel would tell them to set it up
 * again — the exact failure pqc-handlers.ts documents.
 *
 * Run with:
 *   node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/relay-cache.test.ts
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
// Same trick as tests/profile-read.test.ts: the loader hook redirects
// lib/browser.ts to this mock, so import the mock rather than lib/browser.
import browser, { resetMockStorage } from './helpers/browser-mock.ts';
import {
  RELAY_CACHE_FRESH_MS,
  cachedRelayRead,
  cacheKey,
  PQC_PUBLISHED_CACHE,
  MUTE_LIST_CACHE,
} from '../src/lib/bg/relayCache.ts';
import * as popupNames from '../src/services/relayCacheNames.ts';

const PUBKEY = 'a'.repeat(64);

async function ageCache(name: string): Promise<void> {
  const key = cacheKey(name, PUBKEY);
  const stored = await browser.storage.local.get(key);
  await browser.storage.local.set({ [key]: { ...stored[key], fetchedAt: Date.now() - RELAY_CACHE_FRESH_MS - 1 } });
}

/** The shape these tests cache; `unreachable` is what the helper keys off. */
interface Answer { published: boolean; current?: boolean; unreachable?: boolean }

describe('cachedRelayRead', () => {
  afterEach(() => resetMockStorage());

  it('does the live read when nothing is cached', async () => {
    let calls = 0;
    const got = await cachedRelayRead<Answer>('t', PUBKEY, async () => { calls++; return { published: true }; });
    assert.deepEqual(got, { published: true });
    assert.equal(calls, 1);
  });

  it('serves a stale cached answer without waiting for the relays', async () => {
    await cachedRelayRead<Answer>('t', PUBKEY, async () => ({ published: true }));
    await ageCache('t');

    let released: (() => void) | null = null;
    const blocked = new Promise<void>((r) => { released = r; });
    // A read that never settles stands in for the stalled relay this exists for.
    const got = await cachedRelayRead<Answer>('t', PUBKEY, async () => {
      await blocked;
      return { published: false };
    });
    assert.deepEqual(got, { published: true }, 'must not wait on the relay');
    released!();
  });

  it('NEVER caches an unreachable read', async () => {
    await cachedRelayRead<Answer>('t', PUBKEY, async () => ({ published: false, unreachable: true }));
    const stored = await browser.storage.local.get(cacheKey('t', PUBKEY)) as Record<string, unknown>;
    assert.equal(stored[cacheKey('t', PUBKEY)], undefined);
  });

  it('an unreachable refresh does not evict a real answer', async () => {
    // The regression this guards: one flaky read must not turn a live
    // attestation into "set it up again" for every later popup open.
    await cachedRelayRead<Answer>('t', PUBKEY, async () => ({ published: true, current: true }));
    await ageCache('t');
    await cachedRelayRead<Answer>('t', PUBKEY, async () => ({ published: false, unreachable: true }));

    const served = await cachedRelayRead<Answer>('t', PUBKEY, async () => ({ published: false, unreachable: true }));
    assert.deepEqual(served, { published: true, current: true });
  });

  it('a later real answer replaces the cached one', async () => {
    await cachedRelayRead<Answer>('t', PUBKEY, async () => ({ published: false }));
    await ageCache('t');
    // Refresh runs behind the cached read, so let the microtask queue drain.
    await cachedRelayRead<Answer>('t', PUBKEY, async () => ({ published: true }));
    await new Promise((r) => setTimeout(r, 0));

    const served = await cachedRelayRead<Answer>('t', PUBKEY, async () => ({ published: false, unreachable: true }));
    assert.deepEqual(served, { published: true });
  });

  it('caches per pubkey, so switching accounts cannot cross answers', async () => {
    const other = 'b'.repeat(64);
    await cachedRelayRead<Answer>('t', PUBKEY, async () => ({ published: true }));
    const got = await cachedRelayRead<Answer>('t', other, async () => ({ published: false }));
    assert.deepEqual(got, { published: false });
  });
});

describe('cache names', () => {
  it('the popup and the background agree', () => {
    // Duplicated on purpose so the popup does not import a background module;
    // this is what keeps the two copies honest. A rename on one side alone
    // would leave the popup listening on a key nothing ever writes — the card
    // would simply never refresh, silently.
    assert.equal(popupNames.PQC_PUBLISHED_CACHE, PQC_PUBLISHED_CACHE);
    assert.equal(popupNames.MUTE_LIST_CACHE, MUTE_LIST_CACHE);
  });

  it('the storage key carries the prefix the popup listens for', () => {
    assert.equal(cacheKey(PQC_PUBLISHED_CACHE, PUBKEY), `relayCache_${PQC_PUBLISHED_CACHE}_${PUBKEY}`);
    assert.ok(cacheKey(MUTE_LIST_CACHE, PUBKEY).startsWith(`relayCache_${MUTE_LIST_CACHE}_`));
  });
});

describe('relay cache feedback regression', () => {
  afterEach(() => resetMockStorage());

  it('a cache-change listener can re-read without starting another network query', async () => {
    const name = 'feedback';
    const key = cacheKey(name, PUBKEY);
    let queries = 0;
    const pending: Array<() => Promise<Answer>> = [];
    const read = async (): Promise<Answer> => { queries++; return { published: true }; };
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && key in changes) pending.push(() => cachedRelayRead(name, PUBKEY, read));
    };
    browser.storage.onChanged.addListener(listener);
    try {
      await cachedRelayRead(name, PUBKEY, read);
      // Model the popup's async RPC after the cache notification. Bound the
      // reproduction so the broken implementation cannot run forever.
      for (let i = 0; i < 10 && pending.length; i++) {
        await pending.shift()!();
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(queries, 1, 'reading a just-written cache must not reopen relay sockets');
      assert.equal(pending.length, 0, 'the notification chain must terminate');
    } finally { browser.storage.onChanged.removeListener(listener); }
  });
});

it('many readers share one cold query and fresh cache reads perform no network work', async () => {
  const name = 'many-readers';
  let queries = 0;
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const read = async (): Promise<Answer> => { queries++; await wait; return { published: true }; };
  const reads = Array.from({length:20}, () => cachedRelayRead(name, PUBKEY, read));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queries, 1);
  release();
  await Promise.all(reads);
  await Promise.all(Array.from({length:200}, () => cachedRelayRead(name, PUBKEY, read)));
  assert.equal(queries, 1);
});

it('a successful publication cannot be overwritten by an older in-flight negative check', async () => {
  const { seedRelayCache } = await import('../src/lib/bg/relayCache.ts');
  let finish!: () => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const pending = cachedRelayRead<Answer>('publish-race', PUBKEY, async () => {
    started();
    await new Promise<void>(resolve => { finish = resolve; });
    return {published:false};
  });
  await ready;
  await seedRelayCache('publish-race',PUBKEY,{published:true,current:true});
  finish(); await pending;
  assert.deepEqual(await cachedRelayRead<Answer>('publish-race',PUBKEY,async () => ({published:false})), {published:true,current:true});
});
