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
async function fixture() {
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
      if (req.method === 'connect') response(req.author,{id:req.id,result:'ack'});
      if (req.method === 'switch_relays') response(req.author,{id:req.id,result:JSON.stringify([url])});
      if (req.method === 'get_public_key') response(req.author,{id:req.id,result:pubkey});
    });
  });
  return { url, requests, response, subscriptions,
    async approve(req: Request) {
      let result: string;
      if(req.method==='sign_event') result=JSON.stringify(finalizeEvent(JSON.parse(req.params[0]),remoteKey));
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
