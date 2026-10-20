import {handlers as publishing} from '../src/services/background/publish-handlers.ts';
import {createNip98SignFn} from '../src/services/background/wallet-handlers.ts';
import {beforeEach,after,it} from 'node:test';
import assert from 'node:assert/strict';
import browser, {resetMockStorage} from './helpers/browser-mock.ts';
import * as vault from '../src/services/vault/vault.ts';
import * as bridge from '../src/services/signing/localBridgeSession.ts';
import {captureAccountSession} from '../src/services/signing/accountSession.ts';
import {signEvent} from '../src/lib/crypto/nip01.ts';
import {hexToBytes} from '../src/lib/crypto/utils.ts';
import {handleSignEvent,handleNip44Encrypt} from '../src/services/signing/signer.ts';
import * as permissions from '../src/services/permissions/permissions.ts';

const key='b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef';
const pubkey='dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
function port(url=browser.runtime.getURL('src/entrypoints/local-bridge/index.html')) {
 const messages:any[]=[]; const listeners:Array<(value:any)=>void>=[]; const disconnects:Array<()=>void>=[];
 let rejected=false;
 const value={name:'local-bridge',sender:{id:browser.runtime.id,url,frameId:0},postMessage:(m:any)=>messages.push(m),disconnect:()=>{rejected=true;},onMessage:{addListener:(fn:any)=>listeners.push(fn)},onDisconnect:{addListener:(fn:any)=>disconnects.push(fn)}};
 bridge.acceptLocalBridgePort(value as any);
 return {messages,send:(message:any)=>listeners.forEach(fn=>fn(message)),close:()=>disconnects.forEach(fn=>fn()),get rejected(){return rejected;}};
}
async function connect() {const p=port();p.send({type:'ready',pubkey});await tick();assert.equal(p.messages.at(-1)?.type,'ready');return p;}
beforeEach(async()=>{
 vault.lock();resetMockStorage();
 await vault.create('testpassword123',{accounts:[{id:'a',name:'Test',type:'nsec',pubkey,privkey:key,mnemonic:null,nip46Config:null,readOnly:false,createdAt:1}],activeAccountId:'a'});
 await browser.storage.local.set({activeAccountId:'a',accounts:[{id:'a',type:'nsec',pubkey,readOnly:false}]});
 await browser.storage.sync.set({myPubkey:pubkey});
});
after(()=>vault.lock());
it('accepts only exact dedicated extension document and rejects query/hash impostors',async()=>{
 for(const url of ['https://example.com',browser.runtime.getURL('src/entrypoints/popup/index.html'),browser.runtime.getURL('src/entrypoints/local-bridge/index.html#x')]) assert.equal(port(url).rejected,true);
 assert.equal((await bridge.localBridgeStatus()).selected,false);
 const p=await connect();p.send({type:'ping'});assert.equal(p.messages.at(-1).type,'pong');
 assert.equal((await bridge.localBridgeStatus()).connected,true);
});
it('refuses mismatched identities without selecting signer',async()=>{
 const p=port();p.send({type:'ready',pubkey:'a'.repeat(64)});await tick();assert.equal(p.messages.at(-1).type,'error');assert.equal(await bridge.isLocalBridgeSelected(),false);
});
it('verifies exact event and signature while preserving normal local permission denial',async()=>{
 const p=await connect();await permissions.save('example.com','signEvent',1,'deny','a');
 await assert.rejects(handleSignEvent({kind:1,content:'hello',tags:[],created_at:1},'example.com'),/Permission denied/);
 assert.equal(p.messages.filter(m=>m.type==='request').length,0);
 await permissions.save('example.com','signEvent',1,'allow','a');
 const result=handleSignEvent({kind:1,content:'hello',tags:[],created_at:1},'example.com');await tick();
 const request=p.messages.find(m=>m.type==='request');assert.equal(request.method,'sign_event');
 const signed=await signEvent(JSON.parse(request.params[0]),hexToBytes(key));p.send({type:'response',id:request.id,result:JSON.stringify(signed)});
 assert.deepEqual(await result,signed);
 const changed=bridge.signWithLocalBridge({kind:1,content:'original',tags:[],created_at:1},captureAccountSession(),'example.com');await tick();
 const next=p.messages.at(-1);const altered=await signEvent({...JSON.parse(next.params[0]),content:'changed'},hexToBytes(key));p.send({type:'response',id:next.id,result:JSON.stringify(altered)});
 await assert.rejects(changed,/changed the approved event/);
});
it('routes classic crypto and refuses PQ without contacting phone',async()=>{
 const p=await connect();await permissions.save('example.com','nip44Encrypt',null,'allow','a');
 const result=handleNip44Encrypt(pubkey,'hello','example.com');await tick();const req=p.messages.at(-1);assert.equal(req.method,'nip44_encrypt');assert.deepEqual(req.params,[pubkey,'hello']);p.send({type:'response',id:req.id,result:'ciphertext'});assert.equal(await result,'ciphertext');
 await assert.rejects(handleNip44Encrypt(pubkey,'hello','example.com',{scheme:'pq',recipientKemKey:'x'}),/Remote signers/);
});
it('disconnect cancels requests and retains selection until explicit disable',async()=>{
 const p=await connect();const pending=bridge.cryptoWithLocalBridge('nip44Encrypt',pubkey,'hello',captureAccountSession(),'example.com');
 const rejection=assert.rejects(pending,/disconnected/);p.close();await rejection;
 assert.equal((await bridge.localBridgeStatus()).selected,true);assert.equal((await bridge.localBridgeStatus()).connected,false);
 await assert.rejects(bridge.assertLocalSigningAllowed('a'),/unavailable/);
 await permissions.save('example.com','signEvent',1,'allow','a');
 await assert.rejects(handleSignEvent({kind:1,content:'no fallback',tags:[],created_at:1},'example.com'),/disconnected/);
 await bridge.disableLocalBridge();assert.equal(await bridge.isLocalBridgeSelected(),false);await bridge.assertLocalSigningAllowed('a');
});
it('lock cancels requests and stale port replies cannot revive session',async()=>{
 const p=await connect();const pending=bridge.cryptoWithLocalBridge('nip04Decrypt',pubkey,'ciphertext',captureAccountSession(),'example.com');const rejection=assert.rejects(pending,/session changed/);
 vault.lock();await rejection;p.send({type:'response',id:'old',result:'secret'});assert.equal((await bridge.localBridgeStatus()).connected,false);
});
it('rejects malformed results and ignores unrelated response IDs',async()=>{
 const p=await connect();const pending=bridge.cryptoWithLocalBridge('nip04Encrypt',pubkey,'hello',captureAccountSession(),'example.com');const req=p.messages.at(-1);
 p.send({type:'response',id:'different',result:'ignored'});p.send({type:'response',id:req.id,result:{secret:'bad'}});await assert.rejects(pending,/Invalid phone/);
});
it('promotes matching public-only account without importing any identity secret',async()=>{
 await browser.storage.local.set({activeAccountId:'public',accounts:[{id:'public',name:'Phone public key',type:'npub',pubkey,readOnly:true}]});
 vault.clearActiveAccount();
 const p=await connect();
 assert.equal(vault.getActiveAccountId(),'public');
 const account=vault.getDecryptedPayload().accounts.find(a=>a.id==='public')!;
 assert.equal(account.name,'Phone public key');assert.equal(account.privkey,null);assert.equal(account.mnemonic,null);assert.equal(account.readOnly,true);
 await permissions.save('example.com','signEvent',1,'allow','public');
 const signing=handleSignEvent({kind:1,content:'phone only',tags:[],created_at:1},'example.com');await tick();
 const req=p.messages.at(-1);const signed=await signEvent(JSON.parse(req.params[0]),hexToBytes(key));p.send({type:'response',id:req.id,result:JSON.stringify(signed)});assert.deepEqual(await signing,signed);
 await bridge.disableLocalBridge();
 await assert.rejects(handleSignEvent({kind:1,content:'no key',tags:[],created_at:1},'example.com'),/No private key/);
});
it('refuses no-vault pairing with setup guidance',async()=>{
 await vault.destroy();const p=port();p.send({type:'ready',pubkey});await tick();assert.match(p.messages.at(-1).error,/Set up an extension vault/);
});

it('internal publishing and wallet authentication cannot silently use a local key',async()=>{
 await connect();
 await assert.rejects(publishing.get('signEvent')!({event:{kind:1,content:'test',tags:[],created_at:1}}),/unavailable while the phone signer/);
 const sign=createNip98SignFn('a','https://wallet.example.com/api');
 await assert.rejects(sign({challenge:'a'.repeat(64),payload:'b'.repeat(64),transaction:'c'.repeat(64)}),/unavailable while the phone signer/);
});
it('changing accounts cancels requests even if the original account is restored',async()=>{
 const p=await connect();const pending=bridge.cryptoWithLocalBridge('nip44Decrypt',pubkey,'ciphertext',captureAccountSession(),'example.com');const rejection=assert.rejects(pending,/session changed/);
 vault.clearActiveAccount();await vault.setActiveAccount('a');await rejection;assert.equal((await bridge.localBridgeStatus()).connected,false);assert.equal(p.messages.at(-1).type,'close');
});

it('disable wins against an already-started slow selection write',async()=>{
 const original=browser.storage.local.set;
 let release!:()=>void;
 let writing!:()=>void;
 const started=new Promise<void>(resolve=>{writing=resolve;});
 const held=new Promise<void>(resolve=>{release=resolve;});
 browser.storage.local.set=async values=>{if ('localBridgeAccount:a' in values) {writing();await held;}return original(values);};
 try {
  const p=port();p.send({type:'ready',pubkey});await started;
  const disabled=bridge.disableLocalBridge();await tick();release();await disabled;await tick();
  assert.equal(await bridge.isLocalBridgeSelected(),false);assert.equal((await bridge.localBridgeStatus()).connected,false);
 } finally {release();browser.storage.local.set=original;}
});
it('disconnect after a response resolves still rejects its undelivered result',async()=>{
 const p=await connect();
 const pending=bridge.cryptoWithLocalBridge('nip44Decrypt',pubkey,'ciphertext',captureAccountSession(),'example.com');
 const req=p.messages.at(-1);p.send({type:'response',id:req.id,result:'plaintext'});p.close();
 await assert.rejects(pending,/session changed/);
});
