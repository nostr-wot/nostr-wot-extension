import { beforeEach, describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { liveQuery, isNewerReplaceable } from '../src/services/relays/relay.ts';
import { createRelayPool } from '../src/services/relays/pool.ts';
import { signEvent } from '../src/lib/crypto/nip01.ts';
import { resetMockStorage } from './helpers/browser-mock.ts';
import { schnorr } from '@noble/curves/secp256k1.js';
import type { LiveEvent, LiveQueryOptions } from '../src/domain/relays/types.ts';

class Socket {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  sent: unknown[][] = [];
  closes = 0;
  constructor(readonly respond: (socket: Socket, id: string) => void) {
    queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
  }
  send(raw: string) {
    const message = JSON.parse(raw);
    this.sent.push(message);
    if (message[0] === 'REQ') this.respond(this, message[1]);
  }
  receive(data: unknown[]) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
  close() { this.closes++; this.readyState = 3; this.onclose?.(); }
}
const signed = (time = 10, content = '') => signEvent({ kind: 3, tags: [], content, created_at: time }, new Uint8Array(32).fill(7));
async function collect(options: LiveQueryOptions, relays = ['wss://a']) {
  const events: LiveEvent[] = [];
  for await (const item of liveQuery([{ kinds: [3] }], relays, { closeOnExhaust: true, ...options })) events.push(item);
  return events;
}
const delivered = (events: LiveEvent[]) => events.filter((e): e is Extract<LiveEvent, { type: 'event' | 'update' }> => e.type === 'event' || e.type === 'update');

describe('WoT relay transport', () => {
  beforeEach(() => { resetMockStorage(); mock.restoreAll(); });

  it('coalesces simultaneous identical payloads, never poisoning a valid claimed ID', async () => {
    const event = await signed();
    const verify = schnorr.verify.bind(schnorr);
    const spy = mock.method(schnorr, 'verify', async (...args: Parameters<typeof verify>) => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return verify(...args);
    });
    const events = await collect({ _createSocket: url => new Socket((socket, id) => {
      socket.receive(['EVENT', id, url.endsWith('poison') ? { ...event, content: 'forged' } : event]);
      socket.receive(['EOSE', id]);
    }) as unknown as WebSocket }, ['wss://poison', 'wss://a', 'wss://b', 'wss://c']);
    assert.deepEqual(delivered(events).map(e => e.event.id), [event.id]);
    assert.equal(spy.mock.callCount(), 1, 'one signature verification shared by three valid copies; forged hash fails first');
  });

  it('emits equal-timestamp lower-ID and newer slower-relay replacements', async () => {
    const pair = await Promise.all([signed(10, 'a'), signed(10, 'b')]);
    pair.sort((a, b) => a.id.localeCompare(b.id));
    const newer = await signed(11);
    const events = await collect({ _createSocket: url => new Socket((socket, id) => {
      const slow = url.endsWith('slow');
      setTimeout(() => {
        for (const event of slow ? [pair[0], newer] : [pair[1]]) socket.receive(['EVENT', id, event]);
        socket.receive(['EOSE', id]);
      }, slow ? 20 : 0);
    }) as unknown as WebSocket }, ['wss://fast', 'wss://slow']);
    assert.deepEqual(delivered(events).map(e => e.event.id), [pair[1].id, pair[0].id, newer.id]);
    assert.equal(isNewerReplaceable(pair[0], pair[1]), true);
    assert.equal(isNewerReplaceable(pair[1], pair[0]), false);
    assert.equal(isNewerReplaceable(pair[0], pair[0]), false);
    assert.equal(isNewerReplaceable(pair[0], newer), false);
  });

  it('ignores other subscription IDs and drains verification before timeout exhaustion', async () => {
    const event = await signed();
    const verify = schnorr.verify.bind(schnorr);
    mock.method(schnorr, 'verify', async (...args: Parameters<typeof verify>) => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return verify(...args);
    });
    const events = await collect({ _timeoutMs: 5, _createSocket: () => new Socket((socket, id) => {
      socket.receive(['EVENT', 'wrong', event]);
      socket.receive(['EOSE', 'wrong']);
      socket.receive(['EVENT', id, event]);
    }) as unknown as WebSocket });
    assert.equal(delivered(events).length, 1);
    assert.equal(events.at(-1)?.type, 'exhausted');
    assert.equal(events.some(e => e.type === 'eose'), false);
  });

  it('reuses one connection per relay across many concurrent batches and closes each subscription', async () => {
    const event = await signed();
    const sockets: Socket[] = [];
    const pool = createRelayPool({ _createSocket: () => {
      const socket = new Socket((socket, id) => queueMicrotask(() => {
        socket.receive(['EVENT', id, event]); socket.receive(['EOSE', id]);
      })); sockets.push(socket); return socket as unknown as WebSocket;
    } });
    for (let batch = 0; batch < 10; batch++) {
      const results = await Promise.all([collect(pool, ['wss://a', 'wss://b']), collect(pool, ['wss://a', 'wss://b'])]);
      for (const events of results) assert.equal(delivered(events).length, 1);
    }
    assert.equal(sockets.length, 2);
    for (const socket of sockets) {
      assert.equal(socket.closes, 0);
      assert.equal(socket.sent.filter(m => m[0] === 'REQ').length, 20);
      assert.equal(socket.sent.filter(m => m[0] === 'CLOSE').length, 20);
    }
    pool.close(); pool.close();
    for (const socket of sockets) assert.equal(socket.closes, 1);
    assert.throws(() => pool._createSocket('wss://a'), /closed/);
  });

  it('reconnects a failed physical socket on the next batch', async () => {
    const sockets: Socket[] = [];
    const pool = createRelayPool({ _createSocket: () => {
      const first = sockets.length === 0;
      const socket = new Socket((socket, id) => {
        if (first) socket.onerror?.(); else socket.receive(['EOSE', id]);
      }); sockets.push(socket); return socket as unknown as WebSocket;
    } });
    await collect(pool); await collect(pool);
    assert.equal(sockets.length, 2);
    pool.close();
  });

  it('abort wakes a pending query and releases subscriptions without closing the pool', async () => {
    const abort = new AbortController();
    const sockets: Socket[] = [];
    const pool = createRelayPool({ _createSocket: () => {
      const socket = new Socket(() => queueMicrotask(() => abort.abort()));
      sockets.push(socket); return socket as unknown as WebSocket;
    } });
    assert.deepEqual(await collect({ ...pool, signal: abort.signal }), []);
    assert.equal(sockets[0].sent.filter(m => m[0] === 'CLOSE').length, 1);
    assert.equal(sockets[0].closes, 0);
    assert.deepEqual(await collect({ ...pool, signal: abort.signal }), []);
    assert.equal(sockets.length, 1);
    pool.close();
  });

  it('pool closure and server CLOSED both exhaust active subscriptions', async () => {
    for (const serverClose of [false, true]) {
      const pool = createRelayPool({ _createSocket: () => new Socket((socket, id) => {
        queueMicrotask(() => {
          if (serverClose) socket.receive(['CLOSED', id, 'blocked']);
          else pool.close();
        });
      }) as unknown as WebSocket });
      const events = await collect(pool);
      assert.equal(events.at(-1)?.type, 'exhausted');
      pool.close();
    }
  });

  it('abort suppresses events whose verification is still pending', async () => {
    const event = await signed();
    const controller = new AbortController();
    const verify = schnorr.verify.bind(schnorr);
    let finish!: () => void;
    mock.method(schnorr, 'verify', async (...args: Parameters<typeof verify>) => {
      controller.abort();
      await new Promise<void>(resolve => { finish = resolve; });
      return verify(...args);
    });
    const events = await collect({ signal: controller.signal, _createSocket: () => new Socket((socket, id) => {
      socket.receive(['EVENT', id, event]);
      socket.receive(['EOSE', id]);
    }) as unknown as WebSocket });
    assert.deepEqual(events, []);
    finish();
    await new Promise(resolve => setTimeout(resolve, 5));
  });

});
