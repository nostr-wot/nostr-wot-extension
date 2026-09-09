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
import { resetMockStorage } from './helpers/browser-mock.ts';
import { handlers, isPrivateHost } from '../src/services/background/publish-handlers.ts';

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
import { DEFAULT_RELAYS } from '../src/domain/relays/defaultRelays.ts';
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
