import { it } from 'node:test';
import assert from 'node:assert/strict';
import { eventBelongs, shouldArchive, replacementKey, canCopyEvent } from '../src/domain/archive/policy.ts';
import type { SignedEvent } from '../src/domain/nostr/types.ts';
const event = (patch: Partial<SignedEvent> = {}): SignedEvent => ({ id: 'b'.repeat(64), pubkey: 'a'.repeat(64), sig: 'c'.repeat(128), created_at: 20, kind: 1, content: '', tags: [], ...patch });
it('only archives authored events and explicit private envelopes', () => {
  assert.equal(eventBelongs(event(), 'a'.repeat(64), false), true);
  assert.equal(eventBelongs(event(), 'b'.repeat(64), true), false);
  const gift = event({ kind: 1059, tags: [['p', 'b'.repeat(64)]] });
  assert.equal(eventBelongs(gift, 'b'.repeat(64), true), true);
  assert.equal(eventBelongs(gift, 'b'.repeat(64), false), false);
  assert.equal(eventBelongs(event({ kind: 14 }), 'a'.repeat(64), true), false);
});
it('copy excludes authentication, ephemeral, expired, private and unknown by default', () => {
  for (const kind of [22242, 27235, 20000, 23194]) { assert.equal(shouldArchive(event({ kind })), false); assert.equal(canCopyEvent(event({ kind }), true, true), false); }
  assert.equal(canCopyEvent(event({ kind: 1059 })), false);
  assert.equal(canCopyEvent(event({ kind: 1059 }), true), true);
  assert.equal(canCopyEvent(event({ kind: 9999 })), false);
  assert.equal(canCopyEvent(event({ kind: 9999 }), false, true), true);
  assert.equal(canCopyEvent(event({ kind: 13 }), true, true), false);
  assert.equal(canCopyEvent(event({ tags: [['expiration', '10']] }), false, false, 11), false);
});
it('keeps the explicit copy policy independent of display labels and kind catalogs', () => {
  const allowed = [0, 1, 3, 4, 5, 6, 7, 16, 1059, 10000, 10001, 10002, 10003, 10004, 10005, 10006, 10007, 10015, 10030, 10050, 10063, 30000, 30001, 30002, 30003, 30004, 30023, 30024, 30078];
  for (const kind of allowed) assert.equal(canCopyEvent(event({ kind }), true), true, `kind ${kind}`);
  for (const kind of [8, 9007, 9734, 30311]) assert.equal(canCopyEvent(event({ kind }), true), false, `kind ${kind}`);
  for (const kind of [13, 14, 20000, 22242, 27235, 29999]) assert.equal(canCopyEvent(event({ kind }), true, true), false);
});

it('uses the protocol range boundaries for replacement and ephemeral events', () => {
  for (const kind of [0, 3, 10000, 19999, 30000, 39999]) assert.ok(replacementKey(event({ kind })));
  for (const kind of [1, 9999, 20000, 29999, 40000]) assert.equal(replacementKey(event({ kind })), undefined);
  assert.equal(shouldArchive(event({ kind: 19999 })), true);
  assert.equal(shouldArchive(event({ kind: 30000 })), true);
});

it('explorer filters kinds, message formats and public search without matching ciphertext', async () => {
  const { matchesArchivedEvent } = await import('../src/domain/archive/explorer.ts');
  const record = { event: event({ content: 'Hello world', tags: [['t', 'nostr']] }), sources: ['wss://relay.example'], savedAt: 1 };
  const filter = { tab: 'all' as const, query: 'HELLO' };
  assert.equal(matchesArchivedEvent(record, filter), true);
  assert.equal(matchesArchivedEvent(record, { ...filter, tab: 'messages' }), false);
  assert.equal(matchesArchivedEvent(record, { ...filter, kind: 9999 }), false);
  assert.equal(matchesArchivedEvent(record, { ...filter, query: 'relay.example' }), true);
  assert.equal(matchesArchivedEvent({ ...record, event: { ...record.event, kind: 1059 } }, filter), false);
  assert.equal(matchesArchivedEvent({ ...record, event: { ...record.event, kind: 9999 } }, { tab: 'other', query: 'Kind 9999' }), true);
});
