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
  cachedRelayRead,
  cacheKey,
  PQC_PUBLISHED_CACHE,
  MUTE_LIST_CACHE,
} from '../src/lib/bg/relayCache.ts';
import * as popupNames from '../src/services/relayCacheNames.ts';

const PUBKEY = 'a'.repeat(64);

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

  it('serves the cached answer without waiting for the relays', async () => {
    await cachedRelayRead<Answer>('t', PUBKEY, async () => ({ published: true }));

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
    await cachedRelayRead<Answer>('t', PUBKEY, async () => ({ published: false, unreachable: true }));

    const served = await cachedRelayRead<Answer>('t', PUBKEY, async () => ({ published: false, unreachable: true }));
    assert.deepEqual(served, { published: true, current: true });
  });

  it('a later real answer replaces the cached one', async () => {
    await cachedRelayRead<Answer>('t', PUBKEY, async () => ({ published: false }));
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
