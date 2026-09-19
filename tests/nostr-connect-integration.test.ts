import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer, WebSocket } from 'ws';
import { once } from 'node:events';
import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import * as nip04 from 'nostr-tools/nip04';
import { SimplePool } from 'nostr-tools/pool';
import { BunkerSigner, createNostrConnectURI } from 'nostr-tools/nip46';
import browser, { resetMockStorage } from './helpers/browser-mock.ts';
import * as vault from '../src/services/vault/vault.ts';
import * as signer from '../src/services/signing/signer.ts';
import * as signerRemoteSigner from '../src/services/signing/remoteSigner.ts';
import * as signerApprovalQueue from '../src/services/signing/approvalQueue.ts';
import * as permissions from '../src/services/permissions/permissions.ts';
import * as onboarding from '../src/services/background/onboarding-handlers.ts';

const remoteKey = new Uint8Array(32).fill(7);
const clientKey = new Uint8Array(32).fill(8);
const peerKey = new Uint8Array(32).fill(9);
const pubkey = getPublicKey(remoteKey);
const peer = getPublicKey(peerKey);
const origin = 'integration.example';
const event = { kind: 1, content: 'integration message', tags: [], created_at: 1700000000 };
type Request = { id: string; method: string; params: string[]; author: string };

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 4000;
  while (!await check()) {
    assert.ok(Date.now() < deadline, 'integration condition timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

// A loopback-only relay/bunker. Actual BunkerSigner performs encryption,
// subscription management, signature verification and response correlation.
async function fixture(userKey = remoteKey, authUrl?: string) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `ws://127.0.0.1:${address.port}`;
  const subscriptions = new Map<WebSocket, Map<string, Record<string, unknown>>>();
  const requests: Request[] = [];
  function response(author: string, body: object, key = remoteKey) {
    const encrypted = nip44.v2.encrypt(JSON.stringify(body), nip44.v2.utils.getConversationKey(key, author));
    const signed = finalizeEvent({kind:24133,created_at:Math.floor(Date.now()/1000),tags:[['p',author]],content:encrypted}, key);
    for (const [socket, subs] of subscriptions) for (const [id, filter] of subs) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (filter.authors && !(filter.authors as string[]).includes(signed.pubkey)) continue;
      if (filter['#p'] && !(filter['#p'] as string[]).includes(author)) continue;
      socket.send(JSON.stringify(['EVENT',id,signed]));
    }
  }
  server.on('connection', socket => {
    const subs = new Map<string, Record<string, unknown>>();
    subscriptions.set(socket, subs);
    socket.on('close', () => subscriptions.delete(socket));
    socket.on('message', raw => {
      const [type, id, value] = JSON.parse(raw.toString());
      if (type === 'REQ') { subs.set(id,value); socket.send(JSON.stringify(['EOSE',id])); }
      if (type === 'CLOSE') subs.delete(id);
      if (type !== 'EVENT') return;
      assert.ok(verifyEvent(id), 'request signature must verify');
      assert.equal(id.kind,24133);
      const decoded = JSON.parse(nip44.v2.decrypt(id.content,nip44.v2.utils.getConversationKey(remoteKey,id.pubkey)));
      const req = {...decoded,author:id.pubkey} as Request;
      requests.push(req);
      socket.send(JSON.stringify(['OK',id.id,true,'']));
      if (req.method === 'connect') {
        if (authUrl) {
          response(req.author,{id:req.id,result:'auth_url',error:authUrl});
          setTimeout(()=>response(req.author,{id:req.id,result:'ack'}),20);
        } else response(req.author,{id:req.id,result:'ack'});
      }
      if (req.method === 'switch_relays') response(req.author,{id:req.id,result:JSON.stringify([url])});
      if (req.method === 'get_public_key') response(req.author,{id:req.id,result:getPublicKey(userKey)});
    });
  });
  return { url, requests, response, subscriptions,
    async approve(req: Request) {
      let result: string;
      if(req.method==='sign_event') result=JSON.stringify(finalizeEvent(JSON.parse(req.params[0]),userKey));
      else if(req.method==='nip04_encrypt') result=await nip04.encrypt(remoteKey,req.params[0],req.params[1]);
      else if(req.method==='nip04_decrypt') result=await nip04.decrypt(remoteKey,req.params[0],req.params[1]);
      else if(req.method==='nip44_encrypt') result=nip44.v2.encrypt(req.params[1],nip44.v2.utils.getConversationKey(remoteKey,req.params[0]));
      else if(req.method==='nip44_decrypt') result=nip44.v2.decrypt(req.params[1],nip44.v2.utils.getConversationKey(remoteKey,req.params[0]));
      else throw new Error(`Unexpected approval method ${req.method}`);
      response(req.author,{id:req.id,result});
    },
    async close() { for(const socket of server.clients) socket.terminate(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
  };
}

test('Nostr Connect integration: real relay and remote approvals', {timeout:20000}, async t => {
  const relay=await fixture();
  resetMockStorage(); vault.lock();
  t.after(async()=>{signerRemoteSigner.disconnectNip46('remote'); await signerApprovalQueue.cleanupStale(); vault.lock(); await relay.close();});
  await vault.create('integration-password', {activeAccountId:'remote',accounts:[{
    id:'remote',name:'Integration',type:'nip46',pubkey,privkey:null,mnemonic:null,readOnly:false,createdAt:1,
    nip46Config:{bunkerUrl:`bunker://${pubkey}?relay=${encodeURIComponent(relay.url)}`,relay:relay.url,secret:null,localPrivkey:Buffer.from(clientKey).toString('hex')}
  }]});
  await browser.storage.local.set({activeAccountId:'remote',accounts:[{id:'remote',type:'nip46',pubkey}]});
  await browser.storage.sync.set({myPubkey:pubkey});

  await t.test('connects and waits for remote approval before returning a verified event',async()=>{
    let settled=false;
    const promise=signer.handleSignEvent({...event},origin).finally(()=>{settled=true;});
    await until(()=>relay.requests.some(r=>r.method==='sign_event'));
    assert.equal(settled,false);
    assert.equal(relay.requests.filter(r=>r.method==='connect').length,1);
    const pending=(await browser.storage.session.get('signerPending')).signerPending as {nip46InFlight:boolean}[];
    assert.equal(pending.length,1); assert.equal(pending[0].nip46InFlight,true);
    await relay.approve(relay.requests.find(r=>r.method==='sign_event')!);
    const signed=await promise; assert.equal(signed.pubkey,pubkey); assert.ok(verifyEvent(signed));
    assert.deepEqual((await browser.storage.session.get('signerPending')).signerPending,[]);
  });
  await t.test('correlates concurrent approvals and rejection out of order',async()=>{
    const start=relay.requests.length;
    const results=Promise.allSettled([0,1,2].map(n=>signer.handleSignEvent({...event,content:`batch ${n}`},origin)));
    await until(()=>relay.requests.slice(start).filter(r=>r.method==='sign_event').length===3);
    const req=relay.requests.slice(start);
    await relay.approve(req[2]); relay.response(req[1].author,{id:req[1].id,error:'User rejected'}); await relay.approve(req[0]);
    const settled=await results;
    assert.equal(settled[0].status,'fulfilled'); assert.equal(settled[1].status,'rejected'); assert.equal(settled[2].status,'fulfilled');
    if(settled[0].status==='fulfilled') assert.equal(settled[0].value.content,'batch 0');
    if(settled[2].status==='fulfilled') assert.equal(settled[2].value.content,'batch 2');
    assert.deepEqual((await browser.storage.session.get('signerPending')).signerPending,[]);
  });
  for(const scheme of ['04','44'] as const) await t.test(`NIP-${scheme} encrypt and decrypt approval`,async()=>{
    const encrypt=scheme==='04'?signer.handleNip04Encrypt:signer.handleNip44Encrypt;
    const decrypt=scheme==='04'?signer.handleNip04Decrypt:signer.handleNip44Decrypt;
    let start=relay.requests.length;
    const encrypted=encrypt(peer,'private integration text',origin);
    await until(()=>relay.requests.length>start); await relay.approve(relay.requests[start]);
    const ciphertext=await encrypted;
    assert.notEqual(ciphertext,'private integration text');
    start=relay.requests.length;
    const plaintext=decrypt(peer,ciphertext,origin);
    await until(()=>relay.requests.length>start); await relay.approve(relay.requests[start]);
    assert.equal(await plaintext,'private integration text');
  });
  await t.test('local deny and foreign author never reach the remote signer',async()=>{
    const count=relay.requests.length;
    await permissions.save(origin,'signEvent',1,'deny','remote');
    await assert.rejects(signer.handleSignEvent({...event},origin),/Permission denied/);
    await assert.rejects(signer.handleSignEvent({...event,pubkey:peer},origin),/author/);
    assert.equal(relay.requests.length,count);
    await permissions.save(origin,'signEvent',1,'ask','remote');
  });
  await t.test('cancelling remote approval rejects locally and clears the pending marker',async()=>{
    const count=relay.requests.length;
    const result=assert.rejects(signer.handleSignEvent({...event},origin),/cancel/i);
    await until(()=>relay.requests.length>count);
    const pending=(await browser.storage.session.get('signerPending')).signerPending as {id:string}[];
    await signerApprovalQueue.cancelNip46InFlight(pending[0].id); await result;
    await relay.approve(relay.requests[count]);
    assert.deepEqual((await browser.storage.session.get('signerPending')).signerPending,[]);
  });
  await t.test('disconnect reconnects with the persisted client identity',async()=>{
    signerRemoteSigner.disconnectNip46('remote');
    const start=relay.requests.length;
    const pending=signer.handleSignEvent({...event},origin);
    await until(()=>relay.requests.slice(start).some(r=>r.method==='sign_event'));
    assert.equal(relay.requests[start].method,'connect');
    assert.equal(relay.requests[start].author,getPublicKey(clientKey));
    await relay.approve(relay.requests.slice(start).find(r=>r.method==='sign_event')!); await pending;
  });
  await t.test('locked vault sends nothing until unlock and clears its waiter',async()=>{
    vault.lock(); const start=relay.requests.length;
    const pending=signer.handleSignEvent({...event},origin);
    await until(async()=>((await browser.storage.session.get('signerPending')).signerPending as {waitingForUnlock?:boolean}[]).some(r=>r.waitingForUnlock));
    assert.equal(relay.requests.length,start);
    await vault.unlock('integration-password'); await signerApprovalQueue.onVaultUnlocked();
    await until(()=>relay.requests.slice(start).some(r=>r.method==='sign_event'));
    await relay.approve(relay.requests.slice(start).find(r=>r.method==='sign_event')!); await pending;
    assert.deepEqual((await browser.storage.session.get('signerPending')).signerPending,[]);
  });
  for(const method of ['handleNip04Encrypt','handleNip04Decrypt','handleNip44Encrypt','handleNip44Decrypt'] as const) {
    await t.test(`${method} remote rejection clears pending state`,async()=>{
      const start=relay.requests.length;
      const rejected=assert.rejects(signer[method](peer,'test payload',origin),error=>error==='Remote denied');
      await until(()=>relay.requests.length>start);
      const req=relay.requests[start]; relay.response(req.author,{id:req.id,error:'Remote denied'});
      await rejected;
      assert.deepEqual((await browser.storage.session.get('signerPending')).signerPending,[]);
    });
  }
  await t.test('remote auth URL is opened and the request still waits for approval',async()=>{
    const opened:string[]=[];
    const tabs=browser.tabs as unknown as {create:(args:{url:string})=>Promise<{id:number}>};
    const original=tabs.create;
    tabs.create=((args:{url:string})=>{opened.push(args.url);return Promise.resolve({id:1});}) as typeof original;
    try {
      const start=relay.requests.length;
      const pending=signer.handleSignEvent({...event},origin);
      await until(()=>relay.requests.length>start);
      const req=relay.requests[start];
      relay.response(req.author,{id:req.id,result:'auth_url',error:'https://signer.example/approve'});
      await until(()=>opened.length===1);
      assert.deepEqual(opened,['https://signer.example/approve']);
      await relay.approve(req); await pending;
    } finally {tabs.create=original;}
  });
  await t.test('QR handshake ignores a wrong secret and accepts the matching secret',async()=>{
    const key=new Uint8Array(32).fill(11), client=getPublicKey(key);
    const uri=createNostrConnectURI({clientPubkey:client,relays:[relay.url],secret:'test-secret',name:'Integration'});
    const abort=new AbortController();
    const pool=new SimplePool();
    t.after(()=>pool.close([relay.url]));
    const connection=BunkerSigner.fromURI(key,uri,{pool},abort.signal);
    await until(()=>[...relay.subscriptions.values()].some(sub=>[...sub.values()].some(f=>(f['#p'] as string[])?.includes(client))));
    let connected=false; void connection.then(()=>{connected=true;});
    relay.response(client,{id:'wrong',result:'wrong-secret'});
    await new Promise(resolve=>setTimeout(resolve,30)); assert.equal(connected,false);
    relay.response(client,{id:'connect',result:'test-secret'});
    const remote=await connection; assert.equal(remote.bp.pubkey,pubkey); await remote.close(); pool.close([relay.url]);
  });
  await t.test('QR connection cancellation rejects without a remote handshake',async()=>{
    const key=new Uint8Array(32).fill(12);
    const uri=createNostrConnectURI({clientPubkey:getPublicKey(key),relays:[relay.url],secret:'cancel-secret'});
    const abort=new AbortController();
    const pool=new SimplePool();
    t.after(()=>pool.close([relay.url]));
    const connection=BunkerSigner.fromURI(key,uri,{pool},abort.signal);
    const rejected=assert.rejects(connection,/closed/);
    await until(()=>[...relay.subscriptions.values()].some(sub=>[...sub.values()].some(f=>(f['#p'] as string[])?.includes(getPublicKey(key)))));
    abort.abort(); await rejected;
  });

});

test('remote signer rejects stale connection and cached dispatch continuations', async t => {
  for (const boundary of ['switch', 'lock', 'disconnect'] as const) await t.test(boundary, async t => {
    resetMockStorage(); vault.lock();
    await vault.create('password', { activeAccountId: 'remote-race', accounts: [{
      id: 'remote-race', name: 'Remote', type: 'nip46', pubkey, privkey: null, mnemonic: null, readOnly: false, createdAt: 1,
      nip46Config: { bunkerUrl: `bunker://${pubkey}?relay=wss://relay.example`, relay: 'wss://relay.example', secret: null, localPrivkey: Buffer.from(clientKey).toString('hex') },
    }] });
    let finish!: () => void;
    let dispatched = 0;
    let closed = 0;
    t.mock.method(BunkerSigner, 'fromBunker', () => ({
      connect: () => new Promise<void>(resolve => { finish = resolve; }),
      close: async () => { closed++; },
      nip44Encrypt: async () => { dispatched++; return 'ciphertext'; },
    }));
    const request = signerRemoteSigner.handleNip46Request(vault.getActiveAccount()!, 'nip44Encrypt', {pubkey: peer, plaintext:'private'}, origin);
    await until(() => !!finish);
    const rejected = assert.rejects(request, /locked|switched|session|disconnect/i);
    if (boundary === 'switch') vault.clearActiveAccount();
    else if (boundary === 'lock') vault.lock();
    else signerRemoteSigner.disconnectNip46('remote-race');
    finish();
    await rejected;
    assert.equal(dispatched, 0);
    assert.equal(signerRemoteSigner.isNip46Connected('remote-race'), false);
    assert.ok(closed > 0);
    signerRemoteSigner.disconnectNip46('remote-race'); vault.lock();
  });
});

test('remote cached methods stop at the dispatch boundary after lock', async t => {
  for (const method of ['signEvent', 'nip04Encrypt', 'nip04Decrypt', 'nip44Encrypt', 'nip44Decrypt']) await t.test(method, async t => {
    resetMockStorage(); vault.lock();
    await vault.create('password', { activeAccountId: 'remote-cache', accounts: [{
      id: 'remote-cache', name: 'Remote', type: 'nip46', pubkey, privkey: null, mnemonic: null, readOnly: false, createdAt: 1,
      nip46Config: { bunkerUrl: `bunker://${pubkey}?relay=wss://relay.example`, relay: 'wss://relay.example', secret: null, localPrivkey: Buffer.from(clientKey).toString('hex') },
    }] });
    let dispatched = 0;
    let closed = 0;
    const dispatch = async () => { dispatched++; return 'result'; };
    t.mock.method(BunkerSigner, 'fromBunker', () => ({
      connect: async () => {}, close: async () => { closed++; },
      signEvent: dispatch, nip04Encrypt: dispatch, nip04Decrypt: dispatch, nip44Encrypt: dispatch, nip44Decrypt: dispatch,
    }));
    const acct = vault.getActiveAccount()!;
    const data = { pubkey: peer, plaintext: 'private', ciphertext: 'ciphertext' };
    await signerRemoteSigner.handleNip46Request(acct, method, data, origin);
    assert.equal(signerRemoteSigner.isNip46Connected(acct.id), true);
    const request = signerRemoteSigner.handleNip46Request(acct, method, data, origin);
    vault.lock();
    await assert.rejects(request, /locked|disconnect|session/i);
    assert.equal(dispatched, 1);
    assert.equal(closed, 1);
    assert.equal(signerRemoteSigner.isNip46Connected(acct.id), false);
  });
});

// Amber and hosted bunkers may use a connection key distinct from the user's key.
for (const distinct of [false, true]) for (const flow of ['bunker', 'qr'] as const) test(`Nostr Connect ${flow}: resolve ${distinct ? 'distinct' : 'shared'} user identity before saving`, {timeout: 15000}, async t => {
  const relay = await fixture(distinct ? peerKey : remoteKey);
  const pool = new SimplePool();
  resetMockStorage(); vault.lock();
  onboarding.__simulateServiceWorkerRestart();
  onboarding.__setNip46Deps({
    createNostrConnectURI: params => createNostrConnectURI({...params, relays:['ws://127.0.0.1:1', relay.url]}),
    BunkerSigner: {
      fromURI: (key: Uint8Array, uri: string, opts: object, signal: AbortSignal) => BunkerSigner.fromURI(key, uri, {...opts, pool}, signal),
      fromBunker: (key: Uint8Array, bp: Parameters<typeof BunkerSigner.fromBunker>[1], opts: object) => BunkerSigner.fromBunker(key, bp, {...opts, pool}),
    } as unknown as typeof BunkerSigner,
  });
  t.after(async () => {
    onboarding.__setNip46Deps(); onboarding.__simulateServiceWorkerRestart();
    pool.destroy(); vault.lock(); await relay.close();
  });
  let account: {id:string;pubkey:string; type:string};
  if (flow === 'bunker') {
    const result = await onboarding.handlers.get('onboarding_connectNip46')!({bunkerUrl:`bunker://${pubkey}?relay=${encodeURIComponent(relay.url)}&secret=pairing-secret`}) as {account:typeof account};
    account = result.account;
  } else {
    const init = await onboarding.handlers.get('onboarding_initNostrConnect')!({}) as {sessionId:string;nostrconnectUri:string};
    const uri = new URL(init.nostrconnectUri);
    await until(()=>[...relay.subscriptions.values()].some(sub=>[...sub.values()].some(f=>(f['#p'] as string[])?.includes(uri.hostname))));
    relay.response(uri.hostname,{id:'connect',result:uri.searchParams.get('secret')});
    let result: {connected?:boolean;account?:typeof account} = {};
    await until(async()=>{result = await onboarding.handlers.get('onboarding_pollNostrConnect')!({sessionId:init.sessionId}) as typeof result;return !!result.connected;});
    account = result.account!;
  }
  assert.equal(account.pubkey, distinct ? peer : pubkey, 'account identity must come from get_public_key, not the transport event author');
  assert.equal(account.type, 'nip46');
  assert.ok(relay.requests.some(r=>r.method==='get_public_key'));
  assert.equal('nip46Config' in account, false, 'connection credentials must remain background-only');
  await onboarding.handlers.get('onboarding_createVault')!({account,password:'integration-password'});
  const stored = vault.getAccountForRemoteSigning(account.id)!;
  const pointer = new URL(stored.nip46Config.bunkerUrl);
  assert.equal(pointer.hostname, pubkey, 'retain transport identity for reconnect');
  assert.deepEqual(pointer.searchParams.getAll('relay'), [relay.url], 'retain the signer-selected relays');
  if (flow === 'bunker') {
    const connect = relay.requests.find(r=>r.method==='connect')!;
    assert.deepEqual(connect.params,[pubkey,'pairing-secret']);
  }
  const start = relay.requests.length;
  const pending = signer.handleSignEvent({...event,pubkey:account.pubkey},origin);
  try {
    await until(()=>relay.requests.slice(start).some(r=>r.method==='sign_event'));
    const req = relay.requests.slice(start).find(r=>r.method==='sign_event')!;
    await relay.approve(req);
    const signed = await pending;
    assert.equal(signed.pubkey,account.pubkey);
    assert.ok(verifyEvent(signed));
    assert.equal(req.author,getPublicKey(Buffer.from(stored.nip46Config.localPrivkey!, 'hex')), 'reuse pairing identity');
  } finally { signerRemoteSigner.disconnectNip46(account.id); }
});

test('remote account resolution preserves multiple relays and pairing credentials', async () => {
  const { resolveRemoteAccount } = await import('../src/services/signing/remoteAccount.ts');
  let closed = false;
  const remote = {
    bp: { pubkey, relays: ['wss://one.example', 'wss://two.example'], secret: 'token+/=?' },
    getPublicKey: async () => peer,
    close: async () => { closed = true; },
  } as unknown as BunkerSigner;
  const account = await resolveRemoteAccount(remote, clientKey);
  assert.equal(account.pubkey, peer);
  const uri = new URL(account.nip46Config!.bunkerUrl);
  assert.equal(uri.hostname, pubkey);
  assert.deepEqual(uri.searchParams.getAll('relay'), ['wss://one.example', 'wss://two.example']);
  assert.equal(uri.searchParams.get('secret'), 'token+/=?');
  assert.equal(closed, true);
});

for (const failure of ['invalid identity', 'denied', 'timeout']) test(`remote account resolution: ${failure} cannot create an account`, async t => {
  const { resolveRemoteAccount } = await import('../src/services/signing/remoteAccount.ts');
  let closed = false;
  if (failure === 'timeout') t.mock.timers.enable({ apis: ['setTimeout'] });
  const remote = {
    bp: { pubkey, relays: ['wss://one.example'], secret: null },
    getPublicKey: () => failure === 'denied' ? Promise.reject(new Error('User denied'))
      : failure === 'timeout' ? new Promise<string>(() => {}) : Promise.resolve('not-a-public-key'),
    close: async () => { closed = true; },
  } as unknown as BunkerSigner;
  const rejected = assert.rejects(resolveRemoteAccount(remote, clientKey), failure === 'denied' ? /User denied/ : failure === 'timeout' ? /timed out/ : /invalid public key/);
  if (failure === 'timeout') t.mock.timers.tick(120_000);
  await rejected;
  assert.equal(closed, true);
});

for (const authUrl of ['https://signer.example/login', 'http://signer.example/login']) test(`bunker onboarding auth challenge: ${authUrl}`, {timeout:10000}, async t => {
  const relay = await fixture(peerKey, authUrl);
  const pool = new SimplePool();
  const opened: string[] = [];
  const tabs = browser.tabs as unknown as {create:(args:{url:string})=>Promise<{id:number}>};
  const originalCreate = tabs.create;
  tabs.create = (async ({url}: {url:string}) => { opened.push(url); return {id:1}; }) as typeof originalCreate;
  resetMockStorage(); onboarding.__simulateServiceWorkerRestart();
  onboarding.__setNip46Deps({ BunkerSigner: {
    fromBunker: (key: Uint8Array, bp: Parameters<typeof BunkerSigner.fromBunker>[1], opts: object) => BunkerSigner.fromBunker(key,bp,{...opts,pool}),
  } as unknown as typeof BunkerSigner });
  t.after(async()=>{tabs.create=originalCreate;onboarding.__setNip46Deps();onboarding.__simulateServiceWorkerRestart();pool.destroy();await relay.close();});
  const result = await onboarding.handlers.get('onboarding_connectNip46')!({bunkerUrl:`bunker://${pubkey}?relay=${encodeURIComponent(relay.url)}`}) as {account:{pubkey:string}};
  assert.equal(result.account.pubkey,peer);
  assert.deepEqual(opened,authUrl.startsWith('https://') ? [authUrl] : []);
});
