/**
 * Tests for services/background/publish-handlers.ts — focused on the checkRelayHealth
 * handler's SSRF hardening (scheme allowlist + private-host rejection).
 *
 * Run with the browser mock:
 *   node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/publish-handlers.test.ts
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
// Import the browser mock before any lib/ module so the loader-hook redirect
// resolves to the already-loaded mock module (same pattern as other bg tests).
import browserMock, { resetMockStorage } from './helpers/browser-mock.ts';
import { handlers, isPrivateHost, broadcastEvent } from '../src/services/background/publish-handlers.ts';

const checkRelayHealth = handlers.get('checkRelayHealth')!;

// ── fetch stub ──

const originalFetch = globalThis.fetch;
let fetchedUrls: string[] = [];
let fetchResponseOk = true;

function stubFetch() {
  fetchedUrls = [];
  fetchResponseOk = true;
  globalThis.fetch = (async (url: any, _init?: any) => {
    fetchedUrls.push(String(url));
    return new Response('{}', { status: fetchResponseOk ? 200 : 500 });
  }) as typeof fetch;
}

describe('isPrivateHost', () => {
  it('rejects loopback and localhost variants', () => {
    assert.strictEqual(isPrivateHost('localhost'), true);
    assert.strictEqual(isPrivateHost('LOCALHOST'), true);
    assert.strictEqual(isPrivateHost('127.0.0.1'), true);
    assert.strictEqual(isPrivateHost('127.255.255.255'), true);
    assert.strictEqual(isPrivateHost('[::1]'), true);
    assert.strictEqual(isPrivateHost('::1'), true);
  });

  it('rejects private and link-local ranges', () => {
    assert.strictEqual(isPrivateHost('10.0.0.1'), true);
    assert.strictEqual(isPrivateHost('172.16.0.1'), true);
    assert.strictEqual(isPrivateHost('172.31.255.254'), true);
    assert.strictEqual(isPrivateHost('192.168.1.1'), true);
    assert.strictEqual(isPrivateHost('169.254.169.254'), true);
    assert.strictEqual(isPrivateHost('0.0.0.0'), true);
    assert.strictEqual(isPrivateHost('router.local'), true);
  });

  it('allows public hosts', () => {
    assert.strictEqual(isPrivateHost('relay.damus.io'), false);
    assert.strictEqual(isPrivateHost('1.1.1.1'), false);
    assert.strictEqual(isPrivateHost('172.15.0.1'), false);
    assert.strictEqual(isPrivateHost('172.32.0.1'), false);
    assert.strictEqual(isPrivateHost('192.169.0.1'), false);
    assert.strictEqual(isPrivateHost('mylocal.example.com'), false);
  });
});

describe('checkRelayHealth', () => {
  beforeEach(() => { resetMockStorage(); stubFetch(); });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('probes a wss relay over https', async () => {
    const result = await checkRelayHealth({ url: 'wss://relay.example.com/path?x=1' });
    assert.deepStrictEqual(result, { reachable: true });
    assert.deepStrictEqual(fetchedUrls, ['https://relay.example.com/path?x=1']);
  });

  it('probes a ws relay over http', async () => {
    const result = await checkRelayHealth({ url: 'ws://relay.example.com' });
    assert.deepStrictEqual(result, { reachable: true });
    assert.deepStrictEqual(fetchedUrls, ['http://relay.example.com/']);
  });

  it('reports unreachable on non-OK response', async () => {
    fetchResponseOk = false;
    const result = await checkRelayHealth({ url: 'wss://relay.example.com' });
    assert.deepStrictEqual(result, { reachable: false });
  });

  it('rejects non-websocket schemes without fetching', async () => {
    for (const url of [
      'https://internal.example.com',
      'http://internal.example.com',
      'file:///etc/passwd',
      'ftp://relay.example.com',
      'not a url',
    ]) {
      const result = await checkRelayHealth({ url });
      assert.deepStrictEqual(result, { reachable: false }, `should reject ${url}`);
    }
    assert.deepStrictEqual(fetchedUrls, [], 'must not fetch non-ws(s) URLs');
  });

  it('rejects private/loopback hosts without fetching', async () => {
    for (const url of [
      'wss://localhost:7777',
      'ws://127.0.0.1',
      'wss://10.1.2.3',
      'wss://172.16.5.5:8080',
      'wss://192.168.1.1',
      'wss://169.254.169.254',
      'wss://[::1]:4848',
      'wss://printer.local',
    ]) {
      const result = await checkRelayHealth({ url });
      assert.deepStrictEqual(result, { reachable: false }, `should reject ${url}`);
    }
    assert.deepStrictEqual(fetchedUrls, [], 'must not probe private hosts');
  });

  it('rejects non-string url params without fetching', async () => {
    const result = await checkRelayHealth({ url: 42 as unknown as string });
    assert.deepStrictEqual(result, { reachable: false });
    assert.deepStrictEqual(fetchedUrls, []);
  });
});

describe('publishMuteList -- refuses to build on a read nobody answered', () => {
  beforeEach(() => resetMockStorage());

  it('throws when the caller does not vouch for its read', async () => {
    // publishMuteList's own comment calls round-tripping `rawContent` CRITICAL,
    // because it carries the user's NIP-44-encrypted private mutes. That holds
    // only while rawContent is genuinely theirs. A read that reached no relay
    // resolves an empty one through the success path, and publishing it replaces
    // every private mute with nothing — silently, and permanently, since
    // kind:10000 is replaceable.
    const publishMuteList = handlers.get('publishMuteList')!;

    await assert.rejects(
      publishMuteList({ people: ['abc'], hashtags: [], words: [], events: [], rawContent: '' }),
      /no relay answered/,
      'an unstated read must be treated as unreachable, not assumed good',
    );
  });

  it('throws when the caller states the read failed', async () => {
    const publishMuteList = handlers.get('publishMuteList')!;

    await assert.rejects(
      publishMuteList({
        people: [], hashtags: [], words: [], events: [], rawContent: '',
        readReachable: false,
      }),
      /no relay answered/,
    );
  });
});

import browser from './helpers/browser-mock.ts';
import * as vault from '../src/services/vault/vault.ts';
import { importNsec } from '../src/domain/accounts/creation.ts';
import { DEFAULT_RELAYS_CSV as DEFAULT_RELAYS } from '@constants/relays.ts';
import type { SignedEvent } from '../src/domain/nostr/types.ts';

describe('relay publication uses the displayed configuration', () => {
  const socket = globalThis.WebSocket;
  let events: SignedEvent[];
  let accept = true;
  beforeEach(async () => {
    resetMockStorage(); await vault.destroy();
    const account = await importNsec('07'.repeat(32),'Relay test');
    await vault.create('',{accounts:[account],activeAccountId:account.id});
    events=[]; accept=true;
    class Socket {
      onopen: (()=>void)|null=null;
      onmessage: ((e:{data:string})=>void)|null=null;
      constructor(){queueMicrotask(()=>this.onopen?.());}
      send(raw:string){const [,event]=JSON.parse(raw);events.push(event);queueMicrotask(()=>this.onmessage?.({data:JSON.stringify(['OK',event.id,accept,''])}));}
      close(){}
    }
    globalThis.WebSocket=Socket as unknown as typeof WebSocket;
  });
  afterEach(async()=>{globalThis.WebSocket=socket;await vault.destroy();});
  it('publishes the three visible defaults when storage has no relay setting',async()=>{
    await handlers.get('publishRelayList')!({});
    assert.deepEqual(events[0].tags,DEFAULT_RELAYS.split(',').map(url=>['r',url]));
  });
  it('refuses an empty list or a list with both flags off before broadcasting',async()=>{
    await browser.storage.sync.set({relays:''});
    await assert.rejects(()=>handlers.get('publishRelayList')!({}),/empty/i);
    await browser.storage.sync.set({relays:'wss://one.test'});
    await browser.storage.local.set({relayFlags:{'wss://one.test':{read:false,write:false}}});
    await assert.rejects(()=>handlers.get('publishRelayList')!({}),/empty/i);
    assert.equal(events.length,0);
  });
  it('publishes the UI snapshot instead of stale storage and caches only acknowledged events',async()=>{
    await browser.storage.sync.set({relays:'wss://stale.test'});
    const configuration={relays:['wss://shown.test'],flags:{'wss://shown.test':{read:true,write:false}}};
    const result=await handlers.get('publishRelayList')!({configuration}) as {sent:number};
    assert.ok(result.sent > 0);
    assert.deepEqual(events[0].tags,[['r','wss://shown.test','read']]);
    const cacheKey=`nostr_r_10002_${events[0].pubkey}`;
    assert.equal((await browser.storage.local.get(cacheKey))[cacheKey].id,events[0].id);
    accept=false;
    await browser.storage.local.remove(['lastRelayPublish',cacheKey]);
    await handlers.get('publishRelayList')!({configuration});
    assert.equal((await browser.storage.local.get('lastRelayPublish')).lastRelayPublish,undefined);
    assert.equal((await browser.storage.local.get(cacheKey))[cacheKey],undefined);
  });
});

describe('NIP-46 session display boundary', () => {
  afterEach(async () => { await vault.destroy(); });
  it('returns public session status without connection secrets', async () => {
    resetMockStorage(); await vault.destroy();
    await vault.create('testpassword123', {
      accounts: [{ id: 'remote', name: 'Remote', type: 'nip46', pubkey: '33'.repeat(32), privkey: null, mnemonic: null, readOnly: false, createdAt: 1,
        nip46Config: { bunkerUrl: 'bunker://remote?secret=private', relay: 'wss://relay.example', secret: 'private', localPrivkey: '22'.repeat(32) } }],
      activeAccountId: 'remote',
    });
    await browser.storage.local.set({ activeAccountId: 'remote' });
    assert.deepEqual(await handlers.get('nip46_getSessionInfo')!({}), {
      bunkerPubkey: '33'.repeat(32), relay: 'wss://relay.example', connected: false,
      accountId: 'remote', accountName: 'Remote',
    });
    vault.lock();
    assert.equal(await handlers.get('nip46_getSessionInfo')!({}), null);
  });
});



it('refuses relay-list publication if the account changes during relay reads', async () => {
  resetMockStorage();
  await vault.destroy();
  const main = await importNsec('01'.padStart(64, '0'), 'Main');
  const other = await importNsec('02'.padStart(64, '0'), 'Other');
  await vault.create('test-password-1234', { accounts: [main, other], activeAccountId: main.id });
  await browserMock.storage.local.set({ activeAccountId: main.id });
  await browserMock.storage.sync.set({ relays: 'wss://publish.test' });
  const realSyncGet = browserMock.storage.sync.get;
  const original = globalThis.WebSocket;
  const sent: string[] = [];
  class AckSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    constructor() { queueMicrotask(() => this.onopen?.()); }
    send(raw: string) {
      sent.push(raw);
      const [type, event] = JSON.parse(raw);
      if (type === 'EVENT') queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(['OK', event.id, true, 'saved']) }));
    }
    close() {}
  }
  globalThis.WebSocket = AckSocket as unknown as typeof WebSocket;
  let switched = false;
  browserMock.storage.sync.get = async (keys?: string | string[] | null) => {
    const result = await realSyncGet(keys);
    const wanted = typeof keys === 'string' ? [keys] : keys;
    if (!switched && Array.isArray(wanted) && wanted.includes('relays')) {
      switched = true;
      await vault.setActiveAccount(other.id);
      await browserMock.storage.local.set({ activeAccountId: other.id });
    }
    return result;
  };
  try {
    await assert.rejects(
      () => handlers.get('publishRelayList')!({ pubkey: main.pubkey }),
      /Account switched|session changed|Active account changed/,
    );
    assert.equal(switched, true);
    assert.deepEqual(sent, [], 'the revoked account must not publish');
  } finally {
    browserMock.storage.sync.get = realSyncGet;
    globalThis.WebSocket = original;
    await vault.destroy();
  }
});


it('does not send when the account session is revoked while the relay connects', async () => {
  const original = globalThis.WebSocket;
  const sockets: DeferredSocket[] = [];
  const sent: string[] = [];
  let active = true;
  let checks = 0;
  class DeferredSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    closed = false;
    constructor() { sockets.push(this); }
    send(raw: string) {
      sent.push(raw);
      const [, event] = JSON.parse(raw);
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(['OK', event.id, true, 'saved']) }));
    }
    close() { this.closed = true; }
  }
  globalThis.WebSocket = DeferredSocket as unknown as typeof WebSocket;
  try {
    const event: SignedEvent = { id: 'event-id', pubkey: '11'.repeat(32), sig: '22'.repeat(64), kind: 1, created_at: 1, tags: [], content: '' };
    const pending = broadcastEvent(event, ['wss://publish.test'], () => {
      checks++;
      if (!active) throw new Error('Account switched');
    });
    assert.equal(sockets.length, 1, 'connection starts while the session is valid');
    active = false;
    sockets[0].onopen?.();
    const result = await pending;
    assert.ok(checks > 0, 'session is checked at dispatch');
    assert.deepEqual(sent, [], 'revoked signed event must never reach the relay');
    assert.deepEqual(result, { sent: 0, failed: 1 });
    assert.equal(sockets[0].closed, true, 'revoked connection is closed');
  } finally {
    globalThis.WebSocket = original;
  }
});
