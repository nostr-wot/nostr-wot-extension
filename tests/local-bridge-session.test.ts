import {handlers as vaultHandlers} from '../src/services/background/vault-handlers.ts';
import {handlers as publishing} from '../src/services/background/publish-handlers.ts';
import {createNip98SignFn} from '../src/services/background/wallet-handlers.ts';
import {beforeEach,after,it} from 'node:test';
import assert from 'node:assert/strict';
import browser, {resetMockStorage} from './helpers/browser-mock.ts';
import * as vault from '../src/services/vault/vault.ts';
import * as bridge from '../src/services/signing/localBridgeSession.ts';
import {captureAccountSession,assertAccountSession} from '../src/services/signing/accountSession.ts';
import {signEvent} from '../src/lib/crypto/nip01.ts';
import {hexToBytes} from '../src/lib/crypto/utils.ts';
import {getPending} from '../src/services/signing/approvalQueue.ts';
import {handleSignEvent,handleNip44Encrypt,handleNip44Decrypt,handleNip04Encrypt,handleNip04Decrypt} from '../src/services/signing/signer.ts';
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
it('automatically creates a temporary phone account and restores the previous selection on tab close',async()=>{
 const phone='a'.repeat(64);const p=port();p.send({type:'ready',pubkey:phone});
 for(let i=0;i<100 && !p.messages.some(m=>m.type==='ready'||m.type==='error');i++) await tick();
 assert.equal(p.messages.at(-1).type,'ready');
 const id=vault.getActiveAccountId()!;assert.notEqual(id,'a');
 const account=vault.getDecryptedPayload().accounts.find(a=>a.id===id)!;
 assert.equal(account.pubkey,phone);assert.equal(account.privkey,null);assert.equal(account.mnemonic,null);assert.equal(account.readOnly,true);
 assert.equal((await browser.storage.sync.get('myPubkey')).myPubkey,phone);
 p.close();
 for(let i=0;i<100 && vault.getAccountById(id);i++) await tick();
 assert.equal(vault.getActiveAccountId(),'a');assert.equal(vault.getAccountById(id),null);
 assert.equal((await browser.storage.local.get('activeAccountId')).activeAccountId,'a');
 assert.equal((await browser.storage.sync.get('myPubkey')).myPubkey,pubkey);
 assert.equal((await browser.storage.local.get('accounts')).accounts.length,1);
});
it('rejects malformed phone identities before creating accounts',async()=>{
 const p=port();p.send({type:'ready',pubkey:'bad'});await tick();assert.equal(p.messages.at(-1).type,'error');assert.equal(vault.listAccounts().length,1);
});
it('selects an existing matching account without duplicating or deleting it',async()=>{
 const phone='a'.repeat(64);const a={id:'phone',name:'Saved phone',pubkey:phone,type:'npub' as const,readOnly:true,createdAt:1};
 await vault.addAccount({...a,privkey:null,mnemonic:null,nip46Config:null});
 const {accounts}=await browser.storage.local.get('accounts');await browser.storage.local.set({accounts:[...accounts,a]});
 const p=port();p.send({type:'ready',pubkey:phone});for(let i=0;i<100&&!p.messages.some(m=>m.type==='ready'||m.type==='error');i++)await tick();
 assert.equal(p.messages.at(-1).type,'ready');assert.equal(vault.getActiveAccountId(),'phone');
 await bridge.disableLocalBridge();assert.equal(vault.getActiveAccountId(),'a');assert.equal(vault.getAccountById('phone')?.name,'Saved phone');
});
it('verifies phone signatures while the phone owns permission decisions',async()=>{
 const p=await connect();await permissions.save('example.com','signEvent',1,'deny','a');
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
it('pairs and signs without creating or unlocking a vault',async()=>{
 await vault.destroy();await browser.storage.local.set({accounts:[],activeAccountId:null});
 const p=await connect();
 const {activeAccountId:id,accounts}=await browser.storage.local.get(['activeAccountId','accounts']);
 assert.equal(accounts.length,1);assert.equal(accounts[0].networkSession,true);
 assert.equal(await vault.exists(),false);assert.equal(vault.isLocked(),true);
 await permissions.save('example.com','signEvent',1,'allow',id);
 const signing=handleSignEvent({kind:1,content:'phone only',tags:[],created_at:1},'example.com');await tick();
 const req=p.messages.at(-1);assert.equal(req.type,'request');
 const signed=await signEvent(JSON.parse(req.params[0]),hexToBytes(key));p.send({type:'response',id:req.id,result:JSON.stringify(signed)});
 assert.deepEqual(await signing,signed);
 const session=captureAccountSession(id);assertAccountSession(session);
 assert.throws(()=>assertAccountSession({...session,revision:session.revision+1}),/Phone signer session changed/);
 assert.throws(()=>assertAccountSession({accountId:id,revision:session.revision}),/Vault is locked/);
 p.close();assert.throws(()=>assertAccountSession(session),/Phone signer session changed/);
 await bridge.disableLocalBridge();
 assert.deepEqual((await browser.storage.local.get('accounts')).accounts,[]);
 assert.equal(await vault.exists(),false);
});
it('locked-vault pairing leaves ciphertext untouched and restores the saved account on stop',async()=>{
 const before=(await browser.storage.local.get('keyVault')).keyVault;
 vault.lock();const p=await connect();
 const {activeAccountId:id}=await browser.storage.local.get('activeAccountId');
 assert.notEqual(id,'a');assert.equal(vault.isLocked(),true);
 assert.equal((await bridge.localBridgeStatus()).connected,true);
 assert.deepEqual((await browser.storage.local.get('keyVault')).keyVault,before);
 await permissions.save('example.com','signEvent',1,'deny',id);
 const denied=handleSignEvent({kind:1,content:'phone decides',tags:[],created_at:1},'example.com');
 const rejected=assert.rejects(denied,/Phone denied/);await tick();
 const req=p.messages.find(m=>m.type==='request');assert.ok(req);
 p.send({type:'response',id:req.id,error:'Phone denied'});await rejected;
 const session=captureAccountSession(id);
 await browser.storage.local.set({activeAccountId:'a'});
 assert.throws(()=>assertAccountSession(session),/Phone signer session changed/);
 await browser.storage.local.set({activeAccountId:id});
 await bridge.disableLocalBridge();
 assert.equal((await browser.storage.local.get('activeAccountId')).activeAccountId,'a');
 assert.equal(vault.isLocked(),true);
 assert.deepEqual((await browser.storage.local.get('keyVault')).keyVault,before);
});
it('locked-vault network signing verifies signatures and invalidates requests on lock',async()=>{
 vault.lock();const p=await connect();const {activeAccountId:id}=await browser.storage.local.get('activeAccountId');
 await permissions.save('example.com','signEvent',1,'allow',id);
 const signing=handleSignEvent({kind:1,content:'bad signature',tags:[],created_at:1},'example.com');
 const rejected=assert.rejects(signing,/signature|Invalid|match/i);await tick();
 const req=p.messages.at(-1);const signed=await signEvent(JSON.parse(req.params[0]),hexToBytes(key));
 p.send({type:'response',id:req.id,result:JSON.stringify({...signed,sig:'0'.repeat(128)})});await rejected;
 await permissions.save('example.com','nip44Encrypt',null,'allow',id);
 const encrypt=handleNip44Encrypt(pubkey,'hello','example.com');
 const closed=assert.rejects(encrypt,/session changed|vault session/i);await tick();vault.lock();await closed;
 await bridge.disableLocalBridge();
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

it('reconnecting a temporary account preserves its ownership and original previous account',async()=>{
 const phone='a'.repeat(64);const first=port();first.send({type:'ready',pubkey:phone});
 for(let i=0;i<100&&!first.messages.some(m=>m.type==='ready'||m.type==='error');i++)await tick();
 const id=vault.getActiveAccountId()!;
 await vault.setActiveAccount('a');await browser.storage.local.set({activeAccountId:'a'});
 const second=port();second.send({type:'ready',pubkey:phone});
 for(let i=0;i<100&&!second.messages.some(m=>m.type==='ready'||m.type==='error');i++)await tick();
 assert.equal(second.messages.at(-1).type,'ready');assert.equal(vault.getActiveAccountId(),id);
 await bridge.disableLocalBridge();assert.equal(vault.getAccountById(id),null);assert.equal(vault.getActiveAccountId(),'a');
});

it('cancellation during temporary account persistence rolls back the new account',async()=>{
 const original=browser.storage.local.set;let release!:()=>void;let writing!:()=>void;
 const started=new Promise<void>(resolve=>{writing=resolve;});const held=new Promise<void>(resolve=>{release=resolve;});let intercepted=false;
 browser.storage.local.set=async values=>{
  if ('keyVault' in values&&!intercepted) {intercepted=true;writing();await held;}
  return original(values);
 };
 try {
  const p=port();p.send({type:'ready',pubkey:'a'.repeat(64)});await started;p.close();release();
  for(let i=0;i<100&&!p.messages.some(m=>m.type==='error');i++)await tick();
  assert.equal(p.messages.at(-1).type,'error');assert.equal(vault.listAccounts().length,1);
  assert.equal(vault.getActiveAccountId(),'a');assert.equal((await browser.storage.local.get('localBridgePendingAccount')).localBridgePendingAccount,undefined);
 } finally {release();browser.storage.local.set=original;}
});

it('lock during account creation defers cleanup until unlock without deadlocking it',async()=>{
 const original=browser.storage.local.set;let release!:()=>void;let writing!:()=>void;
 const started=new Promise<void>(resolve=>{writing=resolve;});const held=new Promise<void>(resolve=>{release=resolve;});let intercepted=false;
 browser.storage.local.set=async values=>{
  if ('keyVault' in values&&!intercepted) {intercepted=true;writing();await held;}
  return original(values);
 };
 try {
  const p=port();p.send({type:'ready',pubkey:'a'.repeat(64)});await started;vault.lock();release();
  for(let i=0;i<100&&!p.messages.some(m=>m.type==='error');i++)await tick();
  assert.equal(p.messages.at(-1).type,'error');
  assert.equal(await vault.unlock('testpassword123'),true);
  for(let i=0;i<100&&(await browser.storage.local.get('localBridgePendingAccount')).localBridgePendingAccount;i++)await tick();
  assert.equal(vault.listAccounts().length,1);assert.equal(vault.getActiveAccountId(),'a');
  assert.equal((await browser.storage.local.get('localBridgePendingAccount')).localBridgePendingAccount,undefined);
 } finally {release();browser.storage.local.set=original;}
});


it('a detached account stays outside the vault after unlock and reconnect, then restores local signing',async()=>{
 vault.lock();const first=await connect();const {activeAccountId:id}=await browser.storage.local.get('activeAccountId');
 assert.equal(await vaultHandlers.get('vault_unlock')!({password:'testpassword123'}),true);
 assert.equal((await bridge.localBridgeStatus()).connected,false);
 const second=await connect();
 assert.equal((await browser.storage.local.get('activeAccountId')).activeAccountId,id);
 assert.equal(vault.getAccountById(id),null);
 assert.equal(vault.listAccounts().length,1);
 first.close();assert.equal((await bridge.localBridgeStatus()).connected,true);
 await bridge.disableLocalBridge();
 assert.equal(vault.getActiveAccountId(),'a');assert.equal(vault.getAccountById(id),null);
 await permissions.save('example.com','signEvent',1,'allow','a');
 const signed=await handleSignEvent({kind:1,content:'local restored',tags:[],created_at:1},'example.com');
 assert.equal(signed.pubkey,pubkey);assert.equal(second.messages.some(m=>m.type==='request'),false);
});
it('detached network encryption returns only the live phone response and stop removes grants',async()=>{
 await permissions.setUseGlobalDefaults(false);
 vault.lock();const p=await connect();const {activeAccountId:id}=await browser.storage.local.get('activeAccountId');
 await permissions.save('example.com','nip44Encrypt',null,'allow',id);
 const encrypted=handleNip44Encrypt(pubkey,'hello','example.com');await tick();
 const req=p.messages.at(-1);assert.equal(req.method,'nip44_encrypt');
 p.send({type:'response',id:req.id,result:'phone ciphertext'});assert.equal(await encrypted,'phone ciphertext');
 await bridge.disableLocalBridge();
 assert.notEqual(await permissions.check('example.com','nip44Encrypt',undefined,id),'allow');
});
it('disconnect during detached metadata persistence removes the partial account',async()=>{
 vault.lock();const original=browser.storage.local.set;let release!:()=>void;let writing!:()=>void;
 const started=new Promise<void>(resolve=>{writing=resolve;});const held=new Promise<void>(resolve=>{release=resolve;});let intercepted=false;
 browser.storage.local.set=async values=>{if ('accounts' in values&&!intercepted) {intercepted=true;writing();await held;}return original(values);};
 try {
  const p=port();p.send({type:'ready',pubkey});await started;p.close();release();
  for(let i=0;i<100&&!p.messages.some(m=>m.type==='error');i++)await tick();
  assert.equal(p.messages.at(-1).type,'error');assert.equal((await browser.storage.local.get('accounts')).accounts.length,1);
  assert.equal((await browser.storage.local.get('activeAccountId')).activeAccountId,'a');assert.equal(vault.isLocked(),true);
 } finally {release();browser.storage.local.set=original;}
});

it('delegates ordinary ask requests to the phone without a second extension prompt',async()=>{
 const p=await connect();
 await permissions.setUseGlobalDefaults(false);
 assert.equal(await permissions.check('example.com','signEvent',1,'a'),'ask');
 const signing=handleSignEvent({kind:1,content:'phone approves',tags:[],created_at:1},'example.com');
 await tick(); const req=p.messages.at(-1); assert.equal(req.method,'sign_event');
 assert.equal((await getPending()).length,0);
 const signed=await signEvent(JSON.parse(req.params[0]),hexToBytes(key));
 p.send({type:'response',id:req.id,result:JSON.stringify(signed)});assert.deepEqual(await signing,signed);
 for(const [fn,method] of [[handleNip04Encrypt,'nip04_encrypt'],[handleNip04Decrypt,'nip04_decrypt'],[handleNip44Encrypt,'nip44_encrypt'],[handleNip44Decrypt,'nip44_decrypt']] as const){
  await permissions.save('example.com',method==='nip04_encrypt'?'nip04Encrypt':method==='nip04_decrypt'?'nip04Decrypt':method==='nip44_encrypt'?'nip44Encrypt':'nip44Decrypt',null,'deny','a');
  const result=fn(pubkey,'payload','example.com');await tick();const request=p.messages.at(-1);
  assert.equal(request.method,method);assert.equal((await getPending()).length,0);
  p.send({type:'response',id:request.id,result:'phone result'});assert.equal(await result,'phone result');
 }
 const refused=handleNip44Encrypt(pubkey,'payload','example.com');const rejection=assert.rejects(refused,/Phone denied/);await tick();
 p.send({type:'response',id:p.messages.at(-1).id,error:'Phone denied'});await rejection;
});

for (const action of ['sign','encrypt'] as const) it(`disabling the phone during ${action} approval routing never falls back to a local key`,async()=>{
 await connect();await permissions.setUseGlobalDefaults(false);
 const original=browser.storage.local.get;let armed=true;
 browser.storage.local.get=async(keys:any)=>{
  const result=await original(keys);
  if(armed && keys==='localBridgeAccount:a') {armed=false;await bridge.disableLocalBridge();}
  return result;
 };
 try {
  const work=action==='sign' ? handleSignEvent({kind:1,content:'must not sign locally',tags:[],created_at:1},'example.com') : handleNip44Encrypt(pubkey,'must not encrypt locally','example.com');
  await assert.rejects(work,/disconnected|session|changed/i);
  assert.equal(armed,false);assert.equal((await getPending()).length,0);
 } finally {browser.storage.local.get=original;}
});

it('closing a locked-vault phone tab removes only its temporary public account and grants',async()=>{
 vault.lock();const p=await connect();const {activeAccountId:id}=await browser.storage.local.get('activeAccountId');
 await permissions.setUseGlobalDefaults(false);await permissions.save('example.com','signEvent',1,'allow',id);
 p.close();for(let i=0;i<100 && (await browser.storage.local.get('accounts')).accounts.some((a:any)=>a.id===id);i++)await tick();
 assert.equal((await browser.storage.local.get('activeAccountId')).activeAccountId,'a');
 assert.equal((await browser.storage.local.get('accounts')).accounts.length,1);
 assert.equal(vault.isLocked(),true);
 assert.notEqual(await permissions.check('example.com','signEvent',1,id),'allow');
});
it('tab close after locking hides the temporary identity and removes its vault row on unlock',async()=>{
 const p=port();p.send({type:'ready',pubkey:'a'.repeat(64)});
 for(let i=0;i<100&&!p.messages.some(m=>m.type==='ready');i++)await tick();
 const id=vault.getActiveAccountId()!;vault.lock();p.close();
 for(let i=0;i<100&&(await browser.storage.local.get('activeAccountId')).activeAccountId===id;i++)await tick();
 assert.equal((await browser.storage.local.get('activeAccountId')).activeAccountId,'a');
 assert.equal(await vault.unlock('testpassword123'),true);
 for(let i=0;i<100&&vault.getAccountById(id);i++)await tick();
 assert.equal(vault.getAccountById(id),null);assert.equal(vault.getActiveAccountId(),'a');
});
it('a second locked pairing cannot erase deferred encrypted-account cleanup',async()=>{
 const first=port();first.send({type:'ready',pubkey:'a'.repeat(64)});
 for(let i=0;i<100&&!first.messages.some(m=>m.type==='ready');i++)await tick();
 const id=vault.getActiveAccountId()!;vault.lock();first.close();await tick();
 const second=await connect();second.close();await tick();
 await vault.unlock('testpassword123');
 for(let i=0;i<100&&vault.getAccountById(id);i++)await tick();
 assert.equal(vault.getAccountById(id),null);
});
it('closing an older tab does not interrupt a different newer phone session',async()=>{
 const first=port();first.send({type:'ready',pubkey:'a'.repeat(64)});
 for(let i=0;i<100&&!first.messages.some(m=>m.type==='ready');i++)await tick();
 const oldId=vault.getActiveAccountId()!;
 const second=port();second.send({type:'ready',pubkey:'c'.repeat(64)});
 for(let i=0;i<100&&!second.messages.some(m=>m.type==='ready');i++)await tick();
 assert.equal(second.messages.at(-1).type,'ready');first.close();await tick();
 assert.equal((await bridge.localBridgeStatus()).connected,true);
 second.close();for(let i=0;i<100&&vault.getAccountById(oldId);i++)await tick();
 assert.equal(vault.getAccountById(oldId),null);
});

it('worker startup removes abandoned temporary metadata without deleting saved accounts',async()=>{
 vault.lock();await connect();const {activeAccountId:id}=await browser.storage.local.get('activeAccountId');
 vault.lock();await bridge.cleanupAbandonedLocalBridgeAccounts();
 assert.equal((await browser.storage.local.get('activeAccountId')).activeAccountId,'a');
 assert.equal((await browser.storage.local.get('accounts')).accounts.some((a:any)=>a.id===id),false);
 assert.equal((await browser.storage.local.get('accounts')).accounts.length,1);
});

for(const locked of [false,true]) it(`all event kinds delegate approval to the phone (locked=${locked})`,async()=>{
 const {addAllowedDomain}=await import('../src/services/background/domain-handlers.ts');
 const {rememberSignedFollowList}=await import('../src/services/signing/followListGuard.ts');
 const origin='https://client.test';await addAllowedDomain(origin);await permissions.setUseGlobalDefaults(false);
 if(locked)vault.lock();const p=await connect();
 const now=Math.floor(Date.now()/1000);
 await rememberSignedFollowList(await signEvent({kind:3,content:'',created_at:now-1,tags:[['p','a'.repeat(64)],['p','b'.repeat(64)]]},hexToBytes(key)));
 const events=[
  {kind:30078,content:'encrypted app settings',tags:[['d','app-settings']]},
  {kind:22242,content:'',tags:[['relay','wss://relay.test/'],['challenge','test-challenge']]},
  {kind:27235,content:'',tags:[['u','https://api.test/login'],['method','POST']]},
  {kind:27235,content:'',tags:[['u','https://zaps.nostr-wot.com/api/provision'],['method','POST']]},
  {kind:3,content:'',tags:[]},
 ];
 for(const event of events){
  const work=handleSignEvent({...event,created_at:now},origin);void work.catch(()=>{});
  for(let i=0;i<50&&!p.messages.some(m=>m.type==='request')&&!(await getPending()).length;i++)await tick();
  const pending=await getPending();
  if(pending.length){vault.lock();await assert.rejects(work);assert.fail(`kind ${event.kind} opened an extension approval`);}
  const req=p.messages.find(m=>m.type==='request');assert.ok(req,`kind ${event.kind} must reach phone`);
  const signed=await signEvent(JSON.parse(req.params[0]),hexToBytes(key));p.send({type:'response',id:req.id,result:JSON.stringify(signed)});
  assert.deepEqual(await work,signed);p.messages.splice(0);
 }
});
