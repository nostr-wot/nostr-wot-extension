/**
 * A profile read must say whether anyone answered.
 *
 * kind:0 is replaceable. A caller that merges a field into the result of a read
 * and publishes it replaces the user's whole profile — so if a failed read hands
 * back the same `null` as "this user has no profile yet", the merge produces a
 * document containing only the new field and the user's name, picture, about and
 * nip05 are gone. Silently, and on exactly the flaky-relay day that caused it.
 *
 * EOSE is an answer: a relay saying it holds nothing. A socket that errors or
 * times out is not.
 *
 * Run with:
 *   node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/profile-read.test.ts
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
// Imported for its side effect as much as its API: the loader hook redirects
// lib/browser.ts to this file with a short-circuited file:// URL, which skips
// tsx's resolver. Importing it here normally is what gets the .ts registered.
import { resetMockStorage } from './helpers/browser-mock.ts';
import { fetchKind0Read, fetchMuteList } from '../lib/bg/profile-handlers.ts';

const PUBKEY = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';
const RELAY = ['wss://relay.test'];

type Behaviour = 'eose' | 'event' | 'error';

const realWebSocket = globalThis.WebSocket;

/** A socket that plays one canned behaviour as soon as it is opened. */
function installSocket(behaviour: Behaviour, content = '{"name":"alice","about":"hi"}') {
  class Fake {
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    private sub = '';

    constructor(public url: string) {
      queueMicrotask(() => this.onopen?.());
    }

    send(data: string) {
      this.sub = JSON.parse(data)[1];
      queueMicrotask(() => {
        if (behaviour === 'error') { this.onerror?.(); return; }
        if (behaviour === 'event') {
          this.onmessage?.({
            data: JSON.stringify(['EVENT', this.sub, {
              pubkey: PUBKEY, kind: 0, created_at: 1000, content,
            }]),
          });
        }
        this.onmessage?.({ data: JSON.stringify(['EOSE', this.sub]) });
      });
    }

    close() {}
  }
  (globalThis as { WebSocket: unknown }).WebSocket = Fake;
}

/** A socket that answers a kind:10000 REQ with one canned behaviour. */
function installMuteSocket(behaviour: Behaviour) {
  class Fake {
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    private sub = '';

    constructor(public url: string) { queueMicrotask(() => this.onopen?.()); }

    send(data: string) {
      this.sub = JSON.parse(data)[1];
      queueMicrotask(() => {
        if (behaviour === 'error') { this.onerror?.(); return; }
        if (behaviour === 'event') {
          this.onmessage?.({
            data: JSON.stringify(['EVENT', this.sub, {
              pubkey: PUBKEY, kind: 10000, created_at: 1000,
              content: 'encrypted-private-mutes', tags: [['p', 'abc']],
            }]),
          });
        }
        this.onmessage?.({ data: JSON.stringify(['EOSE', this.sub]) });
      });
    }

    close() {}
  }
  (globalThis as { WebSocket: unknown }).WebSocket = Fake;
}

describe('fetchKind0Read', () => {
  afterEach(() => {
    (globalThis as { WebSocket: unknown }).WebSocket = realWebSocket;
    resetMockStorage();
  });

  it('reports the profile it found, and that the relay answered', async () => {
    installSocket('event');
    const read = await fetchKind0Read(PUBKEY, RELAY);

    assert.equal(read.reachable, true);
    assert.deepEqual(read.metadata, { name: 'alice', about: 'hi' });
  });

  it('distinguishes "this user has no profile" from "nobody answered"', async () => {
    // EOSE with no event is a relay stating authoritatively that it holds no
    // kind:0 — safe to merge into, because there is genuinely nothing to lose.
    installSocket('eose');
    const read = await fetchKind0Read(PUBKEY, RELAY);

    assert.equal(read.metadata, null);
    assert.equal(read.reachable, true, 'EOSE is an answer');
  });

  it('reports a socket failure as unreachable, not as an empty profile', async () => {
    // This is the case that wiped profiles: same null metadata, entirely
    // different meaning. A caller about to publish a replaceable event must be
    // able to tell them apart, and must refuse this one.
    installSocket('error');
    const read = await fetchKind0Read(PUBKEY, RELAY);

    assert.equal(read.metadata, null);
    assert.equal(
      read.reachable,
      false,
      'merging into this null and publishing destroys the profile',
    );
  });

  it('is unreachable when there are no relays to ask at all', async () => {
    const read = await fetchKind0Read(PUBKEY, []);
    assert.equal(read.reachable, false);
    assert.equal(read.metadata, null);
  });
});

describe('fetchMuteList', () => {
  afterEach(() => {
    (globalThis as { WebSocket: unknown }).WebSocket = realWebSocket;
    resetMockStorage();
  });

  it('reports the list it found, and that a relay answered', async () => {
    installMuteSocket('event');
    const list = await fetchMuteList(PUBKEY, RELAY);

    assert.equal(list.reachable, true);
    assert.deepEqual(list.people, ['abc']);
    assert.equal(list.rawContent, 'encrypted-private-mutes');
  });

  it('distinguishes "you mute nobody" from "nobody answered"', async () => {
    // EOSE with no event is a relay stating it holds no list. Safe to build on:
    // there is genuinely nothing to round-trip.
    installMuteSocket('eose');
    const list = await fetchMuteList(PUBKEY, RELAY);

    assert.equal(list.createdAt, 0);
    assert.equal(list.reachable, true, 'EOSE is an answer');
  });

  it('reports a total relay failure as unreachable, not as an empty list', async () => {
    // This is the wipe. The zeroed list resolves through the SUCCESS path, so
    // its empty rawContent looked like "this user has no private mutes" — and
    // publishing that back replaces every NIP-44-encrypted private mute with
    // nothing. publishMuteList's round-trip is only CRITICAL while rawContent
    // is real.
    installMuteSocket('error');
    const list = await fetchMuteList(PUBKEY, RELAY);

    assert.equal(list.rawContent, '');
    assert.equal(
      list.reachable,
      false,
      'publishing over this destroys the private mutes it claims to preserve',
    );
  });

  it('is unreachable with no relays to ask', async () => {
    const list = await fetchMuteList(PUBKEY, []);
    assert.equal(list.reachable, false);
  });
});
