import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { schnorr } from '@noble/curves/secp256k1.js';
import {
  isReplaceable,
  replaceableKey,
  readLocalCache,
  writeLocalCache,
  liveQuery,
} from '../lib/relay.ts';
import { signEvent } from '../lib/crypto/nip01.ts';
import { bytesToHex } from '../lib/crypto/utils.ts';
import mock, { resetMockStorage } from './helpers/browser-mock.ts';
import type { SignedEvent, UnsignedEvent, LiveEvent } from '../lib/types.ts';

// ── Helpers ──

// Inbound relay events are now signature-verified (lib/relay.ts), so test
// events must be genuinely signed — fabricated ids/sigs get dropped.
const PRIV1 = new Uint8Array(32).fill(1);
const PRIV2 = new Uint8Array(32).fill(2);
const PK1 = bytesToHex(schnorr.getPublicKey(PRIV1));
const PK2 = bytesToHex(schnorr.getPublicKey(PRIV2));

async function makeEvent(
  overrides: Partial<UnsignedEvent> = {},
  privkey: Uint8Array = PRIV1,
): Promise<SignedEvent> {
  const unsigned: UnsignedEvent = {
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: '{}',
    ...overrides,
  };
  return signEvent(unsigned, privkey);
}

/** A copy of a validly-signed event with tampered content — id/sig no longer match. */
function forge(event: SignedEvent, content = '{"name":"forged"}'): SignedEvent {
  return { ...event, content };
}

/** Minimal WebSocket mock for liveQuery tests */
class MockWebSocket {
  url: string;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  readyState = 0;
  _closed = false;

  constructor(url: string) {
    this.url = url;
    // Auto-open on next microtask
    queueMicrotask(() => {
      if (!this._closed) {
        this.readyState = 1;
        this.onopen?.({} as Event);
      }
    });
  }

  send(_data: string) {}

  close() {
    this._closed = true;
    this.readyState = 3;
  }

  /** Test helper: simulate receiving a message from the relay */
  _receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  /** Test helper: simulate EOSE for a subscription */
  _eose(subId: string) {
    this._receive(['EOSE', subId]);
  }

  /** Test helper: simulate EVENT for a subscription */
  _event(subId: string, event: SignedEvent) {
    this._receive(['EVENT', subId, event]);
  }
}

// ── Tests ──

describe('isReplaceable', () => {
  it('returns true for kind 0 (profile metadata)', () => {
    assert.strictEqual(isReplaceable(0), true);
  });

  it('returns true for kind 3 (contact list)', () => {
    assert.strictEqual(isReplaceable(3), true);
  });

  it('returns true for kind 10002 (relay list)', () => {
    assert.strictEqual(isReplaceable(10002), true);
  });

  it('returns true for kind 30023 (long-form article)', () => {
    assert.strictEqual(isReplaceable(30023), true);
  });

  it('returns false for kind 1 (short note)', () => {
    assert.strictEqual(isReplaceable(1), false);
  });

  it('returns false for kind 7 (reaction)', () => {
    assert.strictEqual(isReplaceable(7), false);
  });

  it('returns false for kind 9735 (zap receipt)', () => {
    assert.strictEqual(isReplaceable(9735), false);
  });
});

describe('replaceableKey', () => {
  it('produces correct key format', () => {
    assert.strictEqual(
      replaceableKey(0, 'abc123'),
      'nostr_r_0_abc123',
    );
  });

  it('includes kind and full pubkey', () => {
    const key = replaceableKey(10002, 'deadbeef');
    assert.ok(key.includes('10002'));
    assert.ok(key.includes('deadbeef'));
  });
});

describe('readLocalCache / writeLocalCache', () => {
  beforeEach(() => resetMockStorage());

  it('round-trips a replaceable event', async () => {
    const event = await makeEvent({ kind: 0 });
    await writeLocalCache(event);

    const results = await readLocalCache([{ kinds: [0], authors: [PK1] }]);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, event.id);
  });

  it('returns empty for non-replaceable kinds', async () => {
    const event = await makeEvent({ kind: 1 });
    await writeLocalCache(event);

    const results = await readLocalCache([{ kinds: [1], authors: [event.pubkey] }]);
    assert.strictEqual(results.length, 0);
  });

  it('returns empty when no match', async () => {
    const results = await readLocalCache([{ kinds: [0], authors: ['nonexistent'] }]);
    assert.strictEqual(results.length, 0);
  });

  it('handles multiple authors', async () => {
    const e1 = await makeEvent({ kind: 0 }, PRIV1);
    const e2 = await makeEvent({ kind: 0 }, PRIV2);
    await writeLocalCache(e1);
    await writeLocalCache(e2);

    const results = await readLocalCache([{ kinds: [0], authors: [PK1, PK2] }]);
    assert.strictEqual(results.length, 2);
  });

  it('refuses to persist an event with an invalid signature', async () => {
    const forged = forge(await makeEvent({ kind: 0 }));
    await writeLocalCache(forged);

    const results = await readLocalCache([{ kinds: [0], authors: [PK1] }]);
    assert.strictEqual(results.length, 0, 'Forged event must not be cached');
  });

  it('drops unverified events planted directly in storage', async () => {
    // Sanity check: a validly-signed event planted directly in storage IS
    // surfaced (proves the plant lands where readLocalCache looks) ...
    const valid = await makeEvent({ kind: 0 });
    await mock.storage.local.set({ [replaceableKey(0, PK1)]: valid });
    const before = await readLocalCache([{ kinds: [0], authors: [PK1] }]);
    assert.strictEqual(before.length, 1, 'Valid planted event should be surfaced');

    // ... then a stale/poisoned entry from before verification existed is not.
    const forged = forge(valid);
    await mock.storage.local.set({ [replaceableKey(0, PK1)]: forged });
    const results = await readLocalCache([{ kinds: [0], authors: [PK1] }]);
    assert.strictEqual(results.length, 0, 'Unverified cache entry must not be surfaced');
  });
});

describe('liveQuery', () => {
  beforeEach(() => resetMockStorage());

  it('yields cached events first, then relay events, then exhausted', async () => {
    const cachedEvent = await makeEvent({ kind: 0, created_at: 1000 });
    await writeLocalCache(cachedEvent);

    const relayEvent = await makeEvent({ kind: 0, created_at: 2000, content: '{"name":"new"}' });

    const gen = liveQuery(
      [{ kinds: [0], authors: [PK1] }],
      ['wss://relay.test'],
      {
        closeOnExhaust: true,
        _createSocket: (url: string) => {
          const socket = new MockWebSocket(url);
          queueMicrotask(() => {
            // Wait for liveQuery to attach handlers
            setTimeout(() => {
              socket._event('lq000000000000', relayEvent);
              socket._eose('lq000000000000');
            }, 10);
          });
          return socket as unknown as WebSocket;
        },
      },
    );

    const events: LiveEvent[] = [];
    for await (const ev of gen) {
      events.push(ev);
      if (ev.type === 'exhausted') break;
    }

    // Should have: cached event (local), relay update (supersedes), eose, exhausted
    assert.ok(events.length >= 3, `Expected >= 3 events, got ${events.length}`);

    const localEvents = events.filter(e => e.type === 'event' && e.source === 'local');
    assert.strictEqual(localEvents.length, 1, 'Should have 1 local cache event');

    // The relay event with higher created_at should produce an 'update' since kind:0 is replaceable
    const updates = events.filter(e => e.type === 'update');
    assert.strictEqual(updates.length, 1, 'Should have 1 update event');
    if (updates[0].type === 'update') {
      assert.strictEqual(updates[0].event.id, relayEvent.id);
      assert.strictEqual(updates[0].supersedes, cachedEvent.id);
    }

    const exhausted = events.filter(e => e.type === 'exhausted');
    assert.strictEqual(exhausted.length, 1, 'Should have exhausted');
  });

  it('deduplicates events by ID', async () => {
    const event = await makeEvent({ kind: 1, content: 'dup me' });

    const gen = liveQuery(
      [{ kinds: [1], authors: [PK1] }],
      ['wss://relay1.test', 'wss://relay2.test'],
      {
        closeOnExhaust: true,
        _createSocket: (url: string) => {
          const ws = new MockWebSocket(url);
          queueMicrotask(() => {
            setTimeout(() => {
              ws._event('lq000000000000', event);
              ws._eose('lq000000000000');
            }, 10);
          });
          return ws as unknown as WebSocket;
        },
      },
    );

    const events: LiveEvent[] = [];
    for await (const ev of gen) {
      events.push(ev);
      if (ev.type === 'exhausted') break;
    }

    const relayEvents = events.filter(e => e.type === 'event' && e.source === 'relay');
    assert.strictEqual(relayEvents.length, 1, 'Should deduplicate — only 1 relay event');
  });

  it('drops forged events (invalid signature) and accepts valid ones', async () => {
    const validEvent = await makeEvent({ kind: 1, content: 'legit' });
    // Same real id/sig, tampered content — id and signature no longer match.
    const forgedSameId = forge(validEvent, 'evil payload');
    // Fully fabricated sig on otherwise-plausible event.
    const forgedBadSig: SignedEvent = {
      ...(await makeEvent({ kind: 1, content: 'other' })),
      sig: '00'.repeat(64),
    };

    const gen = liveQuery(
      [{ kinds: [1], authors: [PK1] }],
      ['wss://relay.test'],
      {
        closeOnExhaust: true,
        _createSocket: (url: string) => {
          const ws = new MockWebSocket(url);
          queueMicrotask(() => {
            setTimeout(() => {
              // Forged event with the VALID event's id arrives first — it must
              // neither be emitted nor shadow the later legitimate event.
              ws._event('lq000000000000', forgedSameId);
              ws._event('lq000000000000', forgedBadSig);
              ws._event('lq000000000000', validEvent);
              ws._eose('lq000000000000');
            }, 10);
          });
          return ws as unknown as WebSocket;
        },
      },
    );

    const events: LiveEvent[] = [];
    for await (const ev of gen) {
      events.push(ev);
      if (ev.type === 'exhausted') break;
    }

    const relayEvents = events.filter(e => e.type === 'event' && e.source === 'relay');
    assert.strictEqual(relayEvents.length, 1, 'Only the validly-signed event should be emitted');
    if (relayEvents[0].type === 'event') {
      assert.strictEqual(relayEvents[0].event.id, validEvent.id);
      assert.strictEqual(relayEvents[0].event.content, 'legit');
    }
  });

  it('yields exhausted immediately when no relays', async () => {
    const gen = liveQuery([{ kinds: [0], authors: ['abc'] }], [], { closeOnExhaust: true });
    const events: LiveEvent[] = [];
    for await (const ev of gen) {
      events.push(ev);
      if (ev.type === 'exhausted') break;
    }
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'exhausted');
  });

  it('cleans up sockets on generator return', async () => {
    const sockets: MockWebSocket[] = [];
    const gen = liveQuery(
      [{ kinds: [0], authors: ['abc'] }],
      ['wss://relay.test'],
      {
        _createSocket: (url: string) => {
          const ws = new MockWebSocket(url);
          sockets.push(ws);
          // Don't send EOSE — keep connection open
          return ws as unknown as WebSocket;
        },
      },
    );

    // Pull one event (will be from local cache phase — likely nothing)
    // Then force-close the generator
    const iter = gen[Symbol.asyncIterator]();
    // Give time for socket to open
    await new Promise(r => setTimeout(r, 20));
    await gen.return(undefined);

    // All sockets should be closed
    for (const ws of sockets) {
      assert.strictEqual(ws._closed, true, 'Socket should be closed after generator return');
    }
  });

  it('writes to cache when cache option is true', async () => {
    const event = await makeEvent({ kind: 0, created_at: 5000 });

    const gen = liveQuery(
      [{ kinds: [0], authors: [PK1] }],
      ['wss://relay.test'],
      {
        closeOnExhaust: true,
        cache: true,
        _createSocket: (url: string) => {
          const ws = new MockWebSocket(url);
          queueMicrotask(() => {
            setTimeout(() => {
              ws._event('lq000000000000', event);
              ws._eose('lq000000000000');
            }, 10);
          });
          return ws as unknown as WebSocket;
        },
      },
    );

    for await (const ev of gen) {
      if (ev.type === 'exhausted') break;
    }

    // Allow cache write to complete
    await new Promise(r => setTimeout(r, 20));

    const cached = await readLocalCache([{ kinds: [0], authors: [PK1] }]);
    assert.strictEqual(cached.length, 1, 'Event should be cached');
    assert.strictEqual(cached[0].id, event.id);
  });
});
