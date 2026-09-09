import { it } from 'node:test';
import assert from 'node:assert/strict';
import { muteListState, toHexPubkey, normalizeHashtag } from '../src/domain/mutes/muteList.ts';

const empty = { people: [], hashtags: [], words: [], events: [], rawContent: '', createdAt: 0 };
it('mute status distinguishes unknown, missing, empty, private and public lists', () => {
  assert.equal(muteListState(null), 'loading');
  assert.equal(muteListState({ ...empty, reachable: false }), 'unavailable');
  assert.equal(muteListState(empty), 'missing');
  assert.equal(muteListState({ ...empty, createdAt: 123 }), 'empty');
  assert.equal(muteListState({ ...empty, createdAt: 123, rawContent: 'ciphertext' }), 'private');
  assert.equal(muteListState({ ...empty, createdAt: 123, people: ['pk'] }), 'ready');
});
it('public key and hashtag validation rejects incomplete values before Add', () => {
  assert.equal(toHexPubkey('npub1bad'), null);
  assert.equal(toHexPubkey('A'.repeat(64)), 'a'.repeat(64));
  assert.equal(toHexPubkey(''), null);
  assert.equal(normalizeHashtag('#'), null);
  assert.equal(normalizeHashtag('two words'), null);
  assert.equal(normalizeHashtag(' #Nostr '), 'nostr');
});

import { createAsyncScope } from '../src/utils/asyncScope';
import { mergeUnique } from '../src/utils/collections';
import { createResettableTimeout } from '../src/utils/resettableTimeout';
it('async scope rejects older reads and invalidates results when their owner retires', async () => {
  const scope = createAsyncScope();
  const old = scope.start();
  const latest = scope.start();
  await Promise.resolve();
  assert.equal(old(),false);
  assert.equal(latest(),true);
  scope.invalidate();
  assert.equal(latest(),false);
  assert.equal(scope.start()(),true);
});
it('unique merge preserves order and never mutates its inputs', () => {
  const input = Object.freeze(['a','b']);
  assert.deepEqual(mergeUnique(input,['b','c','c']),['a','b','c']);
  assert.deepEqual(input,['a','b']);
  assert.deepEqual(mergeUnique([1],new Set([1,2])),[1,2]);
});
it('replacement feedback outlives the old timeout and disposal cancels pending work', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const timer = createResettableTimeout();
  const calls:string[]=[];
  timer.schedule(()=>calls.push('old'),3000);
  t.mock.timers.tick(2000);
  timer.schedule(()=>calls.push('new'),3000);
  t.mock.timers.tick(1000);
  assert.deepEqual([...calls],[]);
  t.mock.timers.tick(2000);
  assert.deepEqual([...calls],['new']);
  timer.schedule(()=>calls.push('disposed'),100);
  timer.clear(); timer.clear();
  t.mock.timers.tick(100);
  assert.deepEqual([...calls],['new']);
});
