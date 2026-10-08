import { test, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SimplePool } from 'nostr-tools/pool';
import { BunkerSigner } from 'nostr-tools/nip46';
import browser, { resetMockStorage } from './helpers/browser-mock.ts';
import * as onboarding from '../src/services/background/onboarding-handlers.ts';

const pubkey = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const relay = 'wss://offline.invalid';
const sockets: OfflineSocket[] = [];
let openImmediately = true;
class OfflineSocket {
  static OPEN = 1; static CLOSED = 3;
  readyState = 0;
  onopen?: () => void; onclose?: (event: { reason: string }) => void;
  onmessage?: (event: { data: string }) => void; onerror?: (event: unknown) => void;
  listeners = new Map<string, Set<(event: any) => void>>();
  rejectConnectingClose = false;
  constructor() { sockets.push(this); if (openImmediately) queueMicrotask(() => this.open()); }
  addEventListener(type: string, fn: (event: any) => void) { const listeners = this.listeners.get(type) ?? new Set(); listeners.add(fn); this.listeners.set(type, listeners); }
  removeEventListener(type: string, fn: (event: any) => void) { this.listeners.get(type)?.delete(fn); }
  open(force = false) {
    if (!force && this.readyState !== 0) return;
    this.readyState = 1;
    let stopped = false;
    const event = { stopImmediatePropagation() { stopped = true; } };
    for (const fn of this.listeners.get('open') ?? []) { fn(event); if (stopped) return; }
    this.onopen?.();
  }
  send() {}
  close() { if (this.readyState === 0 && this.rejectConnectingClose) throw Error('still connecting'); if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ reason: 'offline closed' }); for (const fn of this.listeners.get('close') ?? []) fn({}); }
}
const NativeSocket = globalThis.WebSocket;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const call = (name: string, params = {}) => onboarding.handlers.get(name)!(params) as Promise<any>;
const active = () => sockets.filter(socket => socket.readyState !== 3).length;
const pools: SimplePool[] = [];
function poolFrom(opts: { pool?: SimplePool }) {
  const options = { websocketImplementation: OfflineSocket as unknown as typeof WebSocket, enableReconnect: false };
  const pool = opts.pool ?? new SimplePool(options);
  pools.push(pool); return pool;
}
function makeSigner(key: Uint8Array, opts: { pool?: SimplePool }) {
  const signer = BunkerSigner.fromBunker(key, { pubkey, relays: [relay], secret: null }, { pool: poolFrom(opts) });
  signer.getPublicKey = async () => pubkey;
  return signer;
}
beforeEach(() => { resetMockStorage(); onboarding.__simulateServiceWorkerRestart(); sockets.length = 0; pools.length = 0; openImmediately = true; globalThis.WebSocket = OfflineSocket as unknown as typeof WebSocket; });
afterEach(async () => { onboarding.__simulateServiceWorkerRestart(); onboarding.__setNip46Deps(); for (const pool of pools) pool.destroy(); for (const socket of sockets) socket.close(); globalThis.WebSocket = NativeSocket; await tick(); });

test('repeated successful QR onboarding closes every owned socket after resolving identity', async () => {
  onboarding.__setNip46Deps({ BunkerSigner: { fromURI: async (key: Uint8Array, _uri: string, opts: object) => makeSigner(key, opts) } as unknown as typeof BunkerSigner });
  for (let i = 0; i < 20; i++) {
    const init = await call('onboarding_initNostrConnect'); await tick(); await tick();
    const result = await call('onboarding_pollNostrConnect', { sessionId: init.sessionId });
    assert.equal(result.connected, true);
    assert.equal(active(), 0, `iteration ${i}: no orphan WebSocket may survive setup`);
  }
});

test('a failed QR handshake closes the pool even though no signer was returned', async () => {
  onboarding.__setNip46Deps({ BunkerSigner: { fromURI: async (_key: Uint8Array, _uri: string, opts: object) => { await poolFrom(opts).ensureRelay(relay); throw Error('handshake failed'); } } as unknown as typeof BunkerSigner });
  const init = await call('onboarding_initNostrConnect'); await tick(); await tick();
  assert.equal((await call('onboarding_pollNostrConnect', { sessionId: init.sessionId })).error, 'handshake failed');
  assert.equal(active(), 0);
});

test('cancel closes CONNECTING sockets and a late signer cannot reopen the disposed transport', async () => {
  openImmediately = false;
  let resolveSigner!: (signer: BunkerSigner) => void;
  let pendingSigner: BunkerSigner;
  onboarding.__setNip46Deps({ BunkerSigner: { fromURI: (key: Uint8Array, _uri: string, opts: object) => { pendingSigner = makeSigner(key, opts); return new Promise<BunkerSigner>(resolve => { resolveSigner = resolve; }); } } as unknown as typeof BunkerSigner });
  const init = await call('onboarding_initNostrConnect'); await tick();
  assert.equal(active(), 1);
  await call('onboarding_cancelNostrConnect', { sessionId: init.sessionId });
  assert.equal(active(), 0, 'CONNECTING sockets must be closed too');
  resolveSigner(pendingSigner!); await tick(); await tick();
  assert.deepEqual(await call('onboarding_pollNostrConnect', { sessionId: init.sessionId }), { expired: true });
  await assert.rejects(pools[0].ensureRelay(relay), /closed|disposed/i);
  assert.equal(active(), 0);
});

test('expiry while waiting disposes the live transport', async () => {
  onboarding.__setNip46Deps({ BunkerSigner: { fromURI: (key: Uint8Array, _uri: string, opts: object) => { makeSigner(key, opts); return new Promise(() => {}); } } as unknown as typeof BunkerSigner });
  const init = await call('onboarding_initNostrConnect'); await tick();
  const data = await browser.storage.session.get('_ncSessions') as any;
  data._ncSessions[init.sessionId].createdAt = Date.now() - 360_000;
  await browser.storage.session.set(data);
  assert.deepEqual(await call('onboarding_pollNostrConnect', { sessionId: init.sessionId }), { expired: true });
  assert.equal(active(), 0);
});

test('onboarding does not destroy a caller-owned shared signer pool', async () => {
  const shared = poolFrom({});
  onboarding.__setNip46Deps({ BunkerSigner: { fromURI: async (key: Uint8Array) => makeSigner(key, { pool: shared }) } as unknown as typeof BunkerSigner });
  const init = await call('onboarding_initNostrConnect'); await tick(); await tick();
  assert.equal((await call('onboarding_pollNostrConnect', { sessionId: init.sessionId })).connected, true);
  assert.equal(active(), 1, 'only the separately owned session pool may be destroyed');
  shared.destroy(); assert.equal(active(), 0);
});

// Exercise the production cache and lock hook, while the real BunkerSigner uses
// only the offline sockets above. Never listen on a port or contact a relay.
import * as vault from '../src/services/vault/vault.ts';
import * as remote from '../src/services/signing/remoteSigner.ts';
const originalFromBunker = BunkerSigner.fromBunker;
async function remoteAccount() {
  vault.lock();
  const account = { id: 'remote-lifetime', name: 'Remote', type: 'nip46' as const, pubkey, privkey: null, mnemonic: null, readOnly: false, createdAt: 1, nip46Config: { bunkerUrl: `bunker://${pubkey}?relay=${encodeURIComponent(relay)}`, relay, secret: null, localPrivkey: '01'.repeat(32) } };
  await vault.create('offline-password', { activeAccountId: account.id, accounts: [account] });
  return account;
}

test('remote signing shares a connection and lock closes its owned socket', async t => {
  const account = await remoteAccount();
  let connects = 0;
  BunkerSigner.fromBunker = (key, bp, opts = {}) => {
    const instance = originalFromBunker(key, bp, { ...opts, pool: poolFrom(opts) });
    instance.connect = async () => { connects++; await tick(); };
    instance.nip44Encrypt = async () => 'ciphertext';
    return instance;
  };
  t.after(() => { BunkerSigner.fromBunker = originalFromBunker; vault.lock(); });
  await Promise.all(Array.from({ length: 20 }, () => remote.handleNip46Request(account, 'nip44Encrypt', { pubkey, plaintext: 'hello' }, 'https://offline.invalid')));
  assert.equal(connects, 1); assert.equal(active(), 1);
  vault.lock(); assert.equal(active(), 0);
});

test('failed remote connect and late resolution after lock leave no live sockets', async t => {
  const account = await remoteAccount();
  let finish!: () => void;
  BunkerSigner.fromBunker = (key, bp, opts = {}) => {
    const instance = originalFromBunker(key, bp, { ...opts, pool: poolFrom(opts) });
    instance.connect = () => new Promise<void>(resolve => { finish = resolve; });
    instance.nip44Encrypt = async () => 'ciphertext';
    return instance;
  };
  t.after(() => { BunkerSigner.fromBunker = originalFromBunker; vault.lock(); });
  const result = assert.rejects(remote.handleNip46Request(account, 'nip44Encrypt', { pubkey, plaintext: 'hello' }, 'https://offline.invalid'), /disconnect|locked|session/i);
  await tick(); await tick(); assert.equal(active(), 1);
  vault.lock(); await result; assert.equal(active(), 0);
  finish(); await tick(); assert.equal(active(), 0);
});

import { Nip46Connection } from '../src/services/signing/nip46Connection.ts';
test('a CONNECTING socket that refuses close is closed on late open before library onopen runs', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  openImmediately = false;
  const owner = new Nip46Connection();
  const pending = assert.rejects(owner.pool.ensureRelay(relay), /timeout|closed|disposed/i);
  await tick();
  const socket = sockets[0]; socket.rejectConnectingClose = true;
  let delivered = 0;
  const libraryOpen = socket.onopen;
  socket.onopen = () => { delivered++; libraryOpen?.(); };
  owner.dispose();
  socket.open(true);
  assert.equal(active(), 0);
  assert.equal(delivered, 0, 'late open must not restore the destroyed relay connection');
  await assert.rejects(owner.pool.ensureRelay(relay), /disposed/);
  t.mock.timers.tick(4000); await pending;
});

test('concurrent QR init calls share one live session', async () => {
  let created = 0;
  onboarding.__setNip46Deps({ BunkerSigner: { fromURI: (key: Uint8Array, _uri: string, opts: object) => { created++; makeSigner(key, opts); return new Promise(() => {}); } } as unknown as typeof BunkerSigner });
  const sessions = await Promise.all(Array.from({ length: 20 }, () => call('onboarding_initNostrConnect')));
  await tick();
  assert.equal(new Set(sessions.map(session => session.sessionId)).size, 1);
  assert.equal(created, 1); assert.equal(active(), 1);
  await call('onboarding_cancelNostrConnect', { sessionId: sessions[0].sessionId });
  assert.equal(active(), 0);
});

test('waiting QR sockets expire even after the popup stops polling', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  onboarding.__setNip46Deps({ BunkerSigner: { fromURI: (key: Uint8Array, _uri: string, opts: object) => { makeSigner(key, opts); return new Promise(() => {}); } } as unknown as typeof BunkerSigner });
  const init = await call('onboarding_initNostrConnect'); await tick(); assert.equal(active(), 1);
  t.mock.timers.tick(300_001); await tick();
  assert.equal(active(), 0);
  assert.deepEqual(await call('onboarding_pollNostrConnect', { sessionId: init.sessionId }), { expired: true });
});

test('a rejected remote connection is disposed before a later retry', async t => {
  const account = await remoteAccount();
  BunkerSigner.fromBunker = (key, bp, opts = {}) => {
    const instance = originalFromBunker(key, bp, { ...opts, pool: poolFrom(opts) });
    instance.connect = async () => { await tick(); throw Error('remote refused'); };
    return instance;
  };
  t.after(() => { BunkerSigner.fromBunker = originalFromBunker; vault.lock(); });
  for (let i = 0; i < 20; i++) {
    await assert.rejects(remote.handleNip46Request(account, 'nip44Encrypt', { pubkey, plaintext: 'hello' }, 'https://offline.invalid'), /remote refused/);
    assert.equal(active(), 0);
  }
});

test('failed status persistence still closes a rejected pairing transport', async () => {
  let rejectPairing!: (error: Error) => void;
  onboarding.__setNip46Deps({ BunkerSigner: { fromURI: (key: Uint8Array, _uri: string, opts: object) => {
    makeSigner(key, opts);
    return new Promise<never>((_, reject) => { rejectPairing = reject; });
  } } as unknown as typeof BunkerSigner });
  await call('onboarding_initNostrConnect'); await tick(); assert.equal(active(), 1);
  const originalSet = browser.storage.session.set;
  browser.storage.session.set = async () => { throw Error('storage unavailable'); };
  try {
    rejectPairing(Error('pairing rejected'));
    await tick(); await tick();
    assert.equal(active(), 0);
  } finally { browser.storage.session.set = originalSet; }
});
