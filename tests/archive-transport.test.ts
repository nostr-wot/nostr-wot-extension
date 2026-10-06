import { matchesRelayFilter } from '../src/domain/relays/filter.ts';
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { nip77 } from 'nostr-tools';
const { Negentropy, NegentropyStorageVector } = nip77;
import { createRelayTransport } from '../src/services/relays/transport.ts';
import { signEvent } from '../src/lib/crypto/nip01.ts';
import type { SignedEvent } from '../src/domain/nostr/types.ts';

class Socket {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  sent: unknown[][] = [];
  closes = 0;
  constructor(readonly respond: (socket: Socket, message: unknown[]) => void) {
    queueMicrotask(() => { this.readyState = 1; this.onopen?.(); });
  }
  send(raw: string) { const data = JSON.parse(raw); this.sent.push(data); this.respond(this, data); }
  receive(data: unknown[]) { this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent); }
  close() { this.closes++; this.readyState = 3; this.onclose?.({ reason: 'remote close' } as CloseEvent); }
}
const signed = (kind = 1, time = 10, content = '', tags: string[][] = []) => signEvent({ kind, tags, content, created_at: time }, new Uint8Array(32).fill(7));
function fixture(respond: (socket: Socket, message: unknown[]) => void, idleMs = 5) {
  const sockets: Socket[] = [];
  const transport = createRelayTransport({ idleMs, _createSocket: () => {
    const socket = new Socket(respond); sockets.push(socket); return socket as unknown as WebSocket;
  } });
  return { transport, sockets };
}

describe('Archive shared transport', () => {
  it('shares read/publish leases and correlates simultaneous publications of the same ID', async () => {
    const event = await signed();
    const { transport, sockets } = fixture((socket, data) => {
      if (data[0] === 'REQ') queueMicrotask(() => { socket.receive(['EVENT', data[1], event]); socket.receive(['EOSE', data[1]]); });
      if (data[0] === 'EVENT') queueMicrotask(() => socket.receive(['OK', event.id, true, 'stored']));
    });
    const [query, first, second] = await Promise.all([transport.queryRelay('wss://relay.test', {}), transport.publishRelay('wss://relay.test', event), transport.publishRelay('wss://relay.test', event)]);
    assert.equal(sockets.length, 1); assert.equal(query.status, 'eose'); assert.equal(first.accepted, true); assert.equal(second.accepted, true);
    await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(sockets[0].closes, 1); transport.close();
  });

  it('isolates account scopes and cancels one subscription without disconnecting siblings', async () => {
    const { transport, sockets } = fixture(() => {});
    const abort = new AbortController();
    const a = transport.queryRelay('wss://relay.test', {}, { signal: abort.signal });
    const b = transport.queryRelay('wss://relay.test', {}, { scope: 'account-a' });
    const c = transport.queryRelay('wss://relay.test', {}, { scope: 'account-b' });
    await new Promise(resolve => setTimeout(resolve, 0)); abort.abort();
    assert.equal((await a).message, 'Query cancelled'); assert.equal(sockets.length, 3);
    for (const socket of sockets.slice(1)) { assert.equal(socket.closes, 0); socket.receive(['EOSE', socket.sent[0][1]]); }
    assert.equal((await b).status, 'eose'); assert.equal((await c).status, 'eose'); transport.close();
  });

  it('retains deletions and all addressable versions, rejects forged and out-of-filter events, drains EOSE', async () => {
    const events = await Promise.all([signed(5), signed(30023, 10, 'a', [['d', 'one']]), signed(30023, 11, 'b', [['d', 'one']]), signed(30023, 12, 'c', [['d', 'two']])]);
    const foreign = await signed(1);
    const { transport } = fixture((socket, data) => {
      if (data[0] !== 'REQ') return;
      socket.receive(['EVENT', data[1], { ...events[0], content: 'forged' }]);
      socket.receive(['EVENT', data[1], foreign]);
      for (const event of events) socket.receive(['EVENT', data[1], event]);
      socket.receive(['EOSE', data[1]]);
    });
    const result = await transport.queryRelay('wss://relay.test', { kinds: [5, 30023] });
    assert.equal(result.status, 'error'); assert.deepEqual(result.events, events); assert.equal(result.received, 6); transport.close();
    assert.equal(matchesRelayFilter(events[1], { authors: [events[1].pubkey], since: 10, until: 10, '#d': ['one'] } as never), true);
    assert.equal(matchesRelayFilter(events[1], { authors: ['f'.repeat(64)] }), false);
    assert.equal(matchesRelayFilter(events[1], { since: 11 }), false);
    assert.equal(matchesRelayFilter(events[1], { until: 9 }), false);
    assert.equal(matchesRelayFilter(events[1], { ids: ['f'.repeat(64)] }), false);
    assert.equal(matchesRelayFilter(events[1], { '#d': ['two'] } as never), false);
  });

  it('reports silence, explicit refusal, connection loss and oversized frames without success', async () => {
    for (const mode of ['timeout', 'closed', 'lost', 'size']) {
      const { transport } = fixture((socket, data) => {
        if (data[0] !== 'REQ') return;
        if (mode === 'closed') socket.receive(['CLOSED', data[1], 'restricted: denied']);
        if (mode === 'lost') socket.close();
        if (mode === 'size') socket.receive(['EVENT', data[1], 'x'.repeat(1024 * 1024)]);
      });
      const result = await transport.queryRelay('wss://relay.test', {}, { timeoutMs: 10 });
      assert.equal(result.status, mode === 'timeout' ? 'timeout' : 'closed');
      assert.ok(result.message); transport.close();
    }
  });

  it('bounds pending verification and suppresses events after cancellation', async () => {
    const event = await signed();
    const abort = new AbortController();
    const { transport } = fixture((socket, data) => {
      if (data[0] !== 'REQ') return;
      for (let i = 0; i < 1025; i++) socket.receive(['EVENT', data[1], event]);
      abort.abort();
    });
    const result = await transport.queryRelay('wss://relay.test', {}, { signal: abort.signal });
    assert.equal(result.status, 'error'); assert.match(result.message!, /queue limit/); assert.deepEqual(result.events, []); transport.close();
  });

  it('reauthenticates only opted-in account scopes on the same connection, then retries once', async () => {
    const event = await signed(); let authCalls = 0; let requests = 0;
    const { transport, sockets } = fixture((socket, data) => {
      if (data[0] === 'REQ' && ++requests === 1) { socket.receive(['AUTH', 'challenge']); socket.receive(['CLOSED', data[1], 'auth-required: identify']); }
      else if (data[0] === 'REQ') { socket.receive(['EVENT', data[1], event]); socket.receive(['EOSE', data[1]]); }
      if (data[0] === 'AUTH') socket.receive(['OK', (data[1] as SignedEvent).id, true, '']);
    });
    const result = await transport.queryRelay('wss://relay.test', {}, { scope: 'account-a', authenticate: async challenge => {
      authCalls++; return signed(22242, Math.floor(Date.now() / 1000), '', [['relay', 'wss://relay.test'], ['challenge', challenge]]);
    } });
    assert.equal(result.status, 'eose'); assert.equal(authCalls, 1); assert.equal(sockets.length, 1); assert.equal(requests, 2); transport.close();
    const anonymous = fixture((socket, data) => { if (data[0] === 'REQ') { socket.receive(['AUTH', 'challenge']); socket.receive(['CLOSED', data[1], 'auth-required: identify']); } });
    const denied = await anonymous.transport.queryRelay('wss://relay.test', {}, { authenticate: async () => { throw new Error('Must not be called'); } });
    assert.equal(denied.status, 'closed'); assert.equal(denied.challenge, 'challenge'); anonymous.transport.close();
  });

  it('checks session at actual send boundary and reports OK refusal', async () => {
    const event = await signed();
    const { transport, sockets } = fixture((socket, data) => { if (data[0] === 'EVENT') socket.receive(['OK', event.id, false, 'blocked: policy']); });
    assert.equal((await transport.publishRelay('wss://relay.test', event, { assertSession: () => { throw new Error('Account changed'); } })).accepted, false);
    assert.equal(sockets[0].sent.length, 0);
    assert.deepEqual(await transport.publishRelay('wss://relay.test', event), { accepted: false, message: 'blocked: policy' }); transport.close();
  });

  it('reconciles IDs using the installed NIP-77 implementation', async () => {
    const first = await signed(1, 10, 'first'), second = await signed(1, 11, 'second');
    const storage = new NegentropyStorageVector(); storage.insert(first.created_at, first.id); storage.insert(second.created_at, second.id); storage.seal();
    const remote = new Negentropy(storage, 60000);
    const { transport } = fixture((socket, data) => {
      if (data[0] === 'NEG-OPEN' || data[0] === 'NEG-MSG') {
        const response = data[0] === 'NEG-OPEN' ? remote.initiate() : remote.reconcile(String(data[2]));
        if (response) queueMicrotask(() => socket.receive(['NEG-MSG', data[1], response]));
      }
    });
    const result = await transport.reconcileRelay('wss://relay.test', {}, [first]);
    assert.equal(result.status, 'complete'); assert.deepEqual(result.missing, [second.id]); assert.equal(result.remoteCount, 2); transport.close();
  });
});

it('authenticates account-scoped publication once and retries the same signed event', async () => {
  const event = await signed(); let publications = 0;
  const { transport, sockets } = fixture((socket, data) => {
    if (data[0] === 'EVENT') {
      assert.deepEqual(data[1], event);
      if (++publications === 1) { socket.receive(['AUTH', 'publish-challenge']); socket.receive(['OK', event.id, false, 'auth-required: identify']); }
      else socket.receive(['OK', event.id, true, 'stored']);
    }
    if (data[0] === 'AUTH') socket.receive(['OK', (data[1] as SignedEvent).id, true, '']);
  });
  const result = await transport.publishRelay('wss://relay.test', event, { scope: 'account-a', authenticate: challenge => signed(22242, 10, '', [['relay', 'wss://relay.test'], ['challenge', challenge]]) });
  assert.equal(result.accepted, true); assert.equal(publications, 2); assert.equal(sockets.length, 1); transport.close();
});

it('marks EOSE restriction hints incomplete and keeps cancellation independent on the same socket', async () => {
  const { transport, sockets } = fixture(() => {});
  const abort = new AbortController();
  const first = transport.queryRelay('wss://relay.test', {}, { signal: abort.signal });
  const second = transport.queryRelay('wss://relay.test', {});
  await new Promise(resolve => setTimeout(resolve, 0));
  abort.abort(); assert.equal((await first).status, 'closed');
  assert.equal(sockets.length, 1); assert.equal(sockets[0].closes, 0);
  const secondId = sockets[0].sent.filter(data => data[0] === 'REQ')[1][1];
  sockets[0].receive(['EOSE', secondId, { 'auth-required': true }]);
  assert.equal((await second).status, 'closed'); transport.close();
});

it('waits for a challenge sent after auth-required and retries only after its acknowledgement', async () => {
  let requests = 0;
  const { transport } = fixture((socket, data) => {
    if (data[0] === 'REQ') {
      if (++requests === 1) {
        socket.receive(['CLOSED', data[1], 'auth-required: identify']);
        queueMicrotask(() => socket.receive(['AUTH', 'late-challenge']));
      } else socket.receive(['EOSE', data[1]]);
    }
    if (data[0] === 'AUTH') socket.receive(['OK', (data[1] as SignedEvent).id, true, '']);
  });
  const result = await transport.queryRelay('wss://relay.test', {}, { scope: 'account-a', timeoutMs: 1000, authenticate: challenge => signed(22242, 10, '', [['relay', 'wss://relay.test'], ['challenge', challenge]]) });
  assert.equal(result.status, 'eose'); assert.equal(requests, 2); transport.close();
});

it('does not loop when an authenticated subscription is refused again', async () => {
  let attempts = 0;
  const { transport } = fixture((socket, data) => {
    if (data[0] === 'REQ') { socket.receive(['AUTH', 'challenge']); socket.receive(['CLOSED', data[1], 'auth-required: denied']); }
    if (data[0] === 'AUTH') socket.receive(['OK', (data[1] as SignedEvent).id, true, '']);
  });
  const result = await transport.queryRelay('wss://relay.test', {}, { scope: 'account-a', timeoutMs: 1000, authenticate: challenge => { attempts++; return signed(22242, 10, '', [['relay', 'wss://relay.test'], ['challenge', challenge]]); } });
  assert.equal(result.status, 'closed'); assert.equal(attempts, 1); transport.close();
});

it('answers AUTH directly and waits past a pre-auth EOSE before accepting coverage', async () => {
  let requests = 0;
  let authCalls = 0;
  const event = await signed();
  const { transport } = fixture((socket, data) => {
    if (data[0] === 'REQ') {
      if (++requests === 1) { socket.receive(['AUTH', 'direct']); socket.receive(['EOSE', data[1]]); }
      else { socket.receive(['EVENT', data[1], event]); socket.receive(['EOSE', data[1]]); }
    }
    if (data[0] === 'AUTH') socket.receive(['OK', (data[1] as SignedEvent).id, true, '']);
  });
  try {
    const result = await transport.queryRelay('wss://relay.test', {}, { scope: 'account', timeoutMs: 1000, authenticate: challenge => { authCalls++; return signed(22242, 10, '', [['relay', 'wss://relay.test'], ['challenge', challenge]]); } });
    assert.equal(authCalls, 1); assert.equal(requests, 2);
    assert.equal(result.status, 'eose'); assert.deepEqual(result.events.map(event => event.id), [event.id]);
  } finally { transport.close(); }
});

it('authenticates an EOSE auth-required hint even when its challenge arrives afterward', async () => {
  let requests = 0;
  const { transport } = fixture((socket, data) => {
    if (data[0] === 'REQ') {
      if (++requests === 1) {
        socket.receive(['EOSE', data[1], { 'auth-required': true }]);
        queueMicrotask(() => socket.receive(['AUTH', 'after-eose']));
      } else socket.receive(['EOSE', data[1]]);
    }
    if (data[0] === 'AUTH') socket.receive(['OK', (data[1] as SignedEvent).id, true, '']);
  });
  try {
    const result = await transport.queryRelay('wss://relay.test', {}, { scope: 'account', timeoutMs: 1000, authenticate: challenge => signed(22242, 10, '', [['relay', 'wss://relay.test'], ['challenge', challenge]]) });
    assert.equal(result.status, 'eose'); assert.equal(requests, 2);
  } finally { transport.close(); }
});

it('reuses acknowledged account authentication on the same physical connection', async () => {
  let authenticated = false;
  let authCalls = 0;
  const { transport, sockets } = fixture((socket, data) => {
    if (data[0] === 'REQ') queueMicrotask(() => {
      if (!authenticated) socket.receive(['AUTH', 'shared-challenge']);
      else socket.receive(['EOSE', data[1]]);
    });
    if (data[0] === 'AUTH') { authenticated = true; socket.receive(['OK', (data[1] as SignedEvent).id, true, '']); }
  }, 1000);
  const options = { scope: 'account', timeoutMs: 1000, authenticate: (challenge: string) => { authCalls++; return signed(22242, 10, '', [['relay', 'wss://relay.test'], ['challenge', challenge]]); } };
  try {
    assert.equal((await transport.queryRelay('wss://relay.test', {}, options)).status, 'eose');
    assert.equal((await transport.queryRelay('wss://relay.test', {}, options)).status, 'eose');
    assert.equal(authCalls, 1); assert.equal(sockets.length, 1);
  } finally { transport.close(); }
});

it('waits for authentication after an ERROR-prefixed requirement and preserves the relay refusal', async () => {
  for (const accepted of [true, false]) {
    let requests = 0;
    let authentications = 0;
    const refusal = 'error: relay needs serviceUrl to be configured before AUTH can work';
    const { transport } = fixture((socket, data) => {
      if (data[0] === 'REQ') {
        if (++requests === 1) {
          socket.receive(['AUTH', 'challenge']);
          socket.receive(['CLOSED', data[1], 'ERROR: auth-required: requested filter requires authentication']);
        } else socket.receive(['EOSE', data[1]]);
      }
      if (data[0] === 'AUTH') {
        authentications++;
        socket.receive(['OK', (data[1] as SignedEvent).id, accepted, accepted ? '' : refusal]);
      }
    });
    try {
      const result = await transport.queryRelay('wss://relay.test', {}, {
        scope: 'account-a', timeoutMs: 1000,
        authenticate: challenge => signed(22242, Math.floor(Date.now() / 1000), '', [['relay', 'wss://relay.test'], ['challenge', challenge]]),
      });
      assert.equal(authentications, 1);
      assert.equal(result.status, accepted ? 'eose' : 'closed');
      assert.equal(result.message, accepted ? undefined : refusal);
      assert.equal(requests, accepted ? 2 : 1);
    } finally { transport.close(); }
  }
});
