import { it } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileArchive } from '../src/services/archive/reconcile.ts';
import { signEvent } from '../src/lib/crypto/nip01.ts';
import type { ArchiveRecord } from '../src/domain/archive/types.ts';
import type { SignedEvent } from '../src/domain/nostr/types.ts';

const sign = (content: string, kind = 1) => signEvent({ kind, tags: [], content, created_at: 10 }, new Uint8Array(32).fill(7));
const record = (event: SignedEvent): ArchiveRecord => ({ event, sources: ['wss://old.test'], savedAt: 1 });
const relay = 'wss://relay.test';
function fixture(local: SignedEvent[], remote: SignedEvent[]) {
  const committed: ArchiveRecord[] = [];
  const queryIds: string[][] = [];
  const dependencies = {
    read: async () => ({ records: local.map(record) }),
    reconcile: async (_relay: string, _filter: unknown, entries: Array<{id:string}>) => ({ status: 'complete' as const, remoteCount: remote.length, missing: remote.filter(event => !entries.some(entry => entry.id === event.id)).map(event => event.id) }),
    query: async (_relay: string, filter: {ids?:string[]}) => { queryIds.push(filter.ids!); return { events: remote.filter(event => filter.ids?.includes(event.id)), status: 'eose' as const, received: filter.ids!.length }; },
    commit: async (_account: string, records: ArchiveRecord[]) => { committed.push(...records); },
  };
  return { dependencies, committed, queryIds };
}
it('reconciles signed matching inventory and commits every missing body before claiming coverage', async () => {
  const first = await sign('first'), second = await sign('second');
  const fx = fixture([first], [first, second]);
  let count = 0;
  const complete = await reconcileArchive('account', first.pubkey, relay, { authors: [first.pubkey], since: 0, until: 20 }, false, { onCount: value => { count = value; } }, undefined, fx.dependencies);
  assert.equal(count, 2);
  assert.equal(complete, true); assert.deepEqual(fx.queryIds, [[second.id]]);
  assert.deepEqual(fx.committed.map(r => r.event), [second]); assert.deepEqual(fx.committed[0].sources, [relay]);
});
it('falls back on unsupported negotiation, partial fetches, invalid signatures and unreturned IDs', async () => {
  const first = await sign('first'), second = await sign('second');
  for (const mode of ['unsupported', 'timeout', 'missing', 'forged']) {
    const fx = fixture([], [first, second]);
    if (mode === 'unsupported') fx.dependencies.reconcile = async () => ({ status: 'closed', missing: [] }) as never;
    else fx.dependencies.query = async () => ({ status: mode === 'timeout' ? 'timeout' : 'eose', received: 2, events: mode === 'forged' ? [first, { ...second, content: 'forged' }] : [first] }) as never;
    assert.equal(await reconcileArchive('a', first.pubkey, relay, { authors: [first.pubkey], since: 0 }, false, {}, undefined, fx.dependencies), false, mode);
    assert.equal(fx.committed.length, mode === 'unsupported' ? 0 : 1);
  }
});
it('does not count an unverified local inventory, advance incremental ranges or persist excluded events', async () => {
  const first = await sign('first'), ephemeral = await sign('auth', 22242);
  const corrupted = fixture([{ ...first, content: 'forged' }], []);
  assert.equal(await reconcileArchive('a', first.pubkey, relay, { since: 0 }, false, {}, undefined, corrupted.dependencies), false);
  const fx = fixture([], [ephemeral]);
  assert.equal(await reconcileArchive('a', first.pubkey, relay, { since: 1 }, false, {}, undefined, fx.dependencies), false);
  assert.equal(await reconcileArchive('a', first.pubkey, relay, { since: 0 }, false, {}, undefined, fx.dependencies), true);
  assert.equal(fx.committed.length, 0);
});
it('honors deadlines, propagates cancellation/session/write failure and never returns coverage after failed persistence', async () => {
  const first = await sign('first'); const fx = fixture([], [first]);
  assert.equal(await reconcileArchive('a', first.pubkey, relay, { since: 0 }, false, {}, Date.now() - 1, fx.dependencies), false);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(reconcileArchive('a', first.pubkey, relay, { since: 0 }, false, { signal: controller.signal }, undefined, fx.dependencies));
  await assert.rejects(reconcileArchive('a', first.pubkey, relay, { since: 0 }, false, { assertSession: () => { throw new Error('changed'); } }, undefined, fx.dependencies), /changed/);
  fx.dependencies.commit = async () => { throw new Error('quota'); };
  await assert.rejects(reconcileArchive('a', first.pubkey, relay, { since: 0 }, false, {}, undefined, fx.dependencies), /quota/);
});
it('fetches at most 100 missing IDs per batch', async () => {
  const events: SignedEvent[] = [];
  for (let i = 0; i < 101; i++) events.push(await sign(String(i)));
  const fx = fixture([], events);
  assert.equal(await reconcileArchive('a', events[0].pubkey, relay, { since: 0 }, false, {}, undefined, fx.dependencies), true);
  assert.deepEqual(fx.queryIds.map(ids => ids.length), [100, 1]); assert.equal(fx.committed.length, 101);
});

it('retries recoverable authentication on fresh scopes without losing partial events', async () => {
  const { queryArchiveRelay } = await import('../src/services/archive/query.ts');
  const event = await sign('partial');
  const scopes: (string | undefined)[] = [];
  const query = async (_relay: string, _filter: unknown, options: { scope?: string } = {}) => {
    scopes.push(options.scope);
    return { status: scopes.length < 3 ? 'closed' as const : 'eose' as const, events: [event], received: 1, message: 'auth-required: authenticate' };
  };
  const result = await queryArchiveRelay(relay, {}, { scope: 'archive:a', authenticate: async () => event }, query);
  assert.equal(scopes.length, 3); assert.equal(new Set(scopes).size, 3);
  assert.equal(result.status, 'eose'); assert.deepEqual(result.events, [event]); assert.equal(result.received, 1);
});
it('bounds authentication retries and does not retry relay configuration errors', async () => {
  const { queryArchiveRelay } = await import('../src/services/archive/query.ts');
  const event = await sign('auth');
  for (const message of ['auth-required: authenticate', 'error: relay needs serviceUrl to be configured before AUTH can work']) {
    let calls = 0;
    const query = async () => { calls++; return { status: 'closed' as const, events: [], received: 0, message }; };
    await queryArchiveRelay(relay, {}, { scope: 'archive:a', authenticate: async () => event }, query);
    assert.equal(calls, message.startsWith('auth-required') ? 3 : 1);
  }
});
