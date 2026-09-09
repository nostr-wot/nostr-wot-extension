import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetMockStorage } from './helpers/browser-mock.ts';
import { fetchRelayList } from '../src/services/background/relay-list-handlers.ts';
import { type RelayListRead } from '@domain/relays/types.ts';
import { parseRelayList, sameRelayList } from '../src/domain/relays/relayList.ts';
import { signEvent } from '../src/lib/crypto/nip01.ts';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
const key = new Uint8Array(32).fill(7);
const pubkey = bytesToHex(schnorr.getPublicKey(key));
const original = globalThis.WebSocket;
afterEach(() => { globalThis.WebSocket = original; resetMockStorage(); });
function mock(events: unknown[], fail = false) {
  let closed = 0;
  class Socket {
    onopen: (() => void) | null = null;
    onmessage: ((e: {data: string}) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { queueMicrotask(() => this.onopen?.()); }
    send(raw: string) {
      const sub = JSON.parse(raw)[1];
      queueMicrotask(() => {
        if (fail) { this.onerror?.(); return; }
        for (const event of events) this.onmessage?.({data: JSON.stringify(['EVENT', sub, event])});
        this.onmessage?.({data: JSON.stringify(['EOSE', sub])});
      });
    }
    close() { closed++; }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  return () => closed;
}
test('NIP-65 markers, duplicate flags, empty events and configuration comparison', () => {
  const parsed = parseRelayList([['r','wss://a','read'],['r','wss://a','write'],['r','wss://b','read'],['r','wss://c'],['r','https://bad'],['r','wss://bad','invalid']]);
  assert.deepEqual(parsed.flags, {'wss://a':{read:true,write:true},'wss://b':{read:true,write:false},'wss://c':{read:true,write:true}});
  assert.deepEqual(parseRelayList([]), {relays:[],flags:{}});
  assert.ok(sameRelayList(parsed, {...parsed,relays:[...parsed.relays].reverse()}));
  assert.equal(sameRelayList(parsed, {...parsed,flags:{}}), false);
});
test('newest signed kind 10002 wins and all discovery sockets close', async () => {
  const old = await signEvent({pubkey,kind:10002,created_at:1,tags:[['r','wss://old']],content:''}, key);
  const latest = await signEvent({pubkey,kind:10002,created_at:2,tags:[['r','wss://new','write']],content:''}, key);
  const closed = mock([latest, old, {...latest, created_at:999}]);
  const result = await fetchRelayList(pubkey,['wss://test','wss://test']);
  assert.equal(result.event?.id, latest.id);
  assert.equal(result.reachable,true);
  assert.ok(closed() > 0);
});
test('missing, unreachable and a published empty list are distinct', async () => {
  mock([]);
  assert.deepEqual(await fetchRelayList(pubkey,['wss://test']), {pubkey,event:null,reachable:true});
  mock([],true);
  assert.deepEqual(await fetchRelayList(pubkey,['wss://test']), {pubkey,event:null,reachable:false});
  const empty = await signEvent({pubkey,kind:10002,created_at:1,tags:[],content:''},key);
  mock([empty]);
  assert.equal((await fetchRelayList(pubkey,['wss://test'])).event?.id,empty.id);
});

test('privileged discovery uses the active account, not a caller-supplied public key', async () => {
  const vault = await import('../src/services/vault/vault.ts');
  const { importNsec } = await import('../src/domain/accounts/creation.ts');
  const { handlers } = await import('../src/services/background/relay-list-handlers.ts');
  await vault.destroy();
  const owner = await importNsec('07'.repeat(32), 'Owner');
  await vault.create('', { accounts: [owner], activeAccountId: owner.id });
  mock([]);
  const result = await handlers.get('getMyRelayList')!({ pubkey: 'ff'.repeat(32) }) as RelayListRead;
  assert.equal(result.pubkey, owner.pubkey);
  assert.equal(result.reachable, true);
  await vault.destroy();
  await assert.rejects(() => handlers.get('getMyRelayList')!({}), /No active account/);
});

test('relay discovery uses the selected public account even when the vault is locked or points elsewhere', async () => {
  const browser = (await import('./helpers/browser-mock.ts')).default;
  const vault = await import('../src/services/vault/vault.ts');
  const { handlers } = await import('../src/services/background/relay-list-handlers.ts');
  await vault.destroy();
  await browser.storage.local.set({accounts:[{id:'public',pubkey}],activeAccountId:'public'});
  const event = await signEvent({pubkey,kind:10002,created_at:2,tags:[['r','wss://mine','read']],content:''},key);
  mock([event]);
  const result = await handlers.get('getMyRelayList')!({pubkey:'ff'.repeat(32)}) as RelayListRead;
  assert.equal(result.pubkey,pubkey);
  assert.equal(result.event?.id,event.id);
  mock([],true);
  const offline = await handlers.get('getMyRelayList')!({}) as RelayListRead;
  assert.equal(offline.event?.id,event.id, 'an outage preserves the verified list');
});

test('PQ checks distinguish exhausted sockets from EOSE and retain the newest signed publication', async () => {
  const { checkPqcPublication } = await import('@services/background/pqc-handlers.ts');
const { PQC_KIND } = await import('@constants/pqc.ts');
  const status = {pubkey,keys:{kem:'new-kem',dsa:'new-dsa'}};
  mock([],true);
  assert.deepEqual(await checkPqcPublication(status,['wss://test']), {published:false,current:false,unreachable:true});
  mock([]);
  assert.deepEqual(await checkPqcPublication(status,['wss://test']), {published:false,current:false});
  const old = await signEvent({pubkey,kind:PQC_KIND,created_at:1,content:'',tags:[['alg','ml-kem-1024','old'],['alg','ml-dsa-87','old']]},key);
  const latest = await signEvent({pubkey,kind:PQC_KIND,created_at:2,content:'',tags:[['alg','ml-kem-1024','new-kem'],['alg','ml-dsa-87','new-dsa']]},key);
  mock([old,latest]);
  assert.deepEqual(await checkPqcPublication(status,['wss://test']), {published:true,current:true});
  for (const fail of [true,false,true]) {
    mock([],fail);
    assert.deepEqual(await checkPqcPublication(status,['wss://test']), {published:true,current:true});
  }
  assert.deepEqual(await checkPqcPublication({...status,keys:{...status.keys,dsa:'rotated'}},['wss://test']), {published:true,current:false});
});

test('discovery falls back to the first displayed account when selection has not been persisted', async () => {
 const browser=(await import('./helpers/browser-mock.ts')).default;
 const {handlers}=await import('../src/services/background/relay-list-handlers.ts');
 await browser.storage.local.set({accounts:[{id:'first',pubkey}]});
 const event=await signEvent({pubkey,kind:10002,created_at:2,tags:[['r','wss://mine']],content:''},key);
 mock([event]);
 const result=await handlers.get('getMyRelayList')!({}) as RelayListRead;
 assert.equal(result.event?.id,event.id);
});

test('relay configuration writes preserve a recoverable previous list and its flags', async () => {
 const browser=(await import('./helpers/browser-mock.ts')).default;
 const {persistRelayConfiguration}=await import('../src/context/RelaysContext.tsx');
 const previous={relays:['wss://previous'],flags:{'wss://previous':{read:true,write:false}}};
 await browser.storage.sync.set({relays:previous.relays.join(',')});
 await browser.storage.local.set({relayFlags:previous.flags});
 await persistRelayConfiguration(['wss://next'],{});
 assert.deepEqual((await browser.storage.local.get('relayConfigurationBackup')).relayConfigurationBackup,previous);
 assert.equal((await browser.storage.sync.get('relays')).relays,'wss://next');
});

test('an empty publication is explained and cannot be applied over a configured list', async () => {
 const {PublishedRelayConfiguration}=await import('../src/screens/Settings/NetworkSection.tsx');
 const {createElement}=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const event=await signEvent({pubkey,kind:10002,created_at:2,tags:[],content:''},key);
 const html=renderToStaticMarkup(createElement(PublishedRelayConfiguration,{result:{pubkey,event,reachable:true},checking:false,local:{relays:['wss://kept'],flags:{}},disabled:false,onApply(){throw new Error('must not clear');},onRetry(){}}));
 assert.match(html,/network.publishedEmpty/);
 assert.match(html,/<button[^>]*disabled=""[^>]*>network.usePublished/);
});

test('stored relay defaults and publication markers round-trip without treating empty as missing', async () => {
 const {configuredRelayUrls,relayPublicationTags}=await import('../src/domain/relays/relayList.ts');
 assert.equal(configuredRelayUrls(undefined).length,3);
 assert.deepEqual(configuredRelayUrls(''),[]);
 const configuration={relays:['wss://both','wss://read','wss://write'],flags:{'wss://read':{read:true,write:false},'wss://write':{read:false,write:true}}};
 assert.ok(sameRelayList(configuration,parseRelayList(relayPublicationTags(configuration))));
 assert.throws(()=>relayPublicationTags({relays:['https://invalid'],flags:{}}),/Invalid/);
});
