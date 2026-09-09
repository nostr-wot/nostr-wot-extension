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
