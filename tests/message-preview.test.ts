import {it,beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import browser,{resetMockStorage} from './helpers/browser-mock.ts';
import * as vault from '../src/services/vault/vault.ts';
import * as permissions from '../src/services/permissions/permissions.ts';
import * as signer from '../src/services/signing/signer.ts';
import {getPending,resolveRequest,cleanupStale,previewPendingRequest,queueRequest} from '../src/services/signing/approvalQueue.ts';
import {importNsec} from '../src/domain/accounts/creation.ts';
import {nip04Encrypt} from '../src/lib/crypto/nip04.ts';
import {nip44Encrypt} from '../src/lib/crypto/nip44.ts';
import {hexToBytes} from '../src/lib/crypto/utils.ts';
import {handlers} from '../src/services/background/nip07-handlers.ts';
import {buildPrivilegedMethods} from '../src/services/background/state.ts';
const site='https://client.test';const secret='private preview content';
const owner=await importNsec('11'.repeat(32),'Owner');const peer=await importNsec('22'.repeat(32),'Peer');
beforeEach(async()=>{
 vault.lock();resetMockStorage();permissions.invalidateCache();await cleanupStale();
 await vault.create('password123',{accounts:[owner,peer],activeAccountId:owner.id});
 await browser.storage.local.set({activeAccountId:owner.id,accounts:[owner,peer].map(({id,pubkey,type})=>({id,pubkey,type}))});
 await permissions.save(site,'nip04Decrypt',null,'ask',owner.id);await permissions.save(site,'nip44Encrypt',null,'ask',owner.id);
});
afterEach(async()=>{vault.lock();await cleanupStale();});
async function pending(){for(let i=0;i<100;i++){const p=await getPending();if(p.length){await new Promise(r=>setTimeout(r,5));return p[0];}await new Promise(r=>setTimeout(r,5));}throw new Error('No prompt');}
for(const [scheme,encrypt,decrypt] of [['nip04',nip04Encrypt,signer.handleNip04Decrypt],['nip44',nip44Encrypt,signer.handleNip44Decrypt]] as const){
 it(`${scheme} reveal stays local and does not resolve or persist the requested message`,async()=>{
  const ciphertext=await encrypt(secret,hexToBytes(peer.privkey!),hexToBytes(owner.pubkey));
  let settled=false;const work=decrypt(peer.pubkey,ciphertext,site);void work.then(()=>{settled=true;},()=>{settled=true;});
  const request=await pending();
  const raw=await previewPendingRequest(request.id,false);assert.equal(raw.plaintext,undefined);assert.equal(raw.request.params.ciphertext,ciphertext);
  assert.equal((await previewPendingRequest(request.id,true)).plaintext,secret);
  assert.equal(settled,false);assert.equal((await getPending()).length,1);
  assert.ok(!JSON.stringify(await browser.storage.session.get(null)).includes(ciphertext));
  assert.ok(!JSON.stringify(await browser.storage.session.get(null)).includes(secret));
  await resolveRequest(request.id,{allow:false});await assert.rejects(work,/denied/i);
  await assert.rejects(previewPendingRequest(request.id,true),/no longer/i);
 });
}
it('outgoing reveal returns the submitted plaintext without encrypting or approving it',async()=>{
 const work=signer.handleNip44Encrypt(peer.pubkey,secret,site);void work.catch(()=>{});const request=await pending();
 assert.equal((await previewPendingRequest(request.id,true)).plaintext,secret);
 assert.equal((await previewPendingRequest(request.id,false)).request.params.plaintext,secret);
 assert.ok(!JSON.stringify(await browser.storage.session.get(null)).includes(secret));
 await resolveRequest(request.id,{allow:false});await assert.rejects(work,/denied/i);
});
it('locking discards preview access',async()=>{
 const work=signer.handleNip44Encrypt(peer.pubkey,secret,site);void work.catch(()=>{});const request=await pending();
 vault.lock();await assert.rejects(previewPendingRequest(request.id,true),/no longer|locked/i);await assert.rejects(work);
});
it('late preview completion cannot return content after the request is rejected',async()=>{
 let finish!:()=>void;const wait=new Promise<void>(r=>{finish=r;});
 const work=queueRequest({type:'nip44Decrypt',origin:site,accountId:owner.id},async()=>{await wait;return {request:{method:'nip44Decrypt',origin:site,params:{}},plaintext:secret};});
 const request=await pending();const preview=previewPendingRequest(request.id,true);void preview.catch(()=>{});
 await resolveRequest(request.id,{allow:false});finish();await assert.rejects(preview,/no longer/i);assert.equal((await work).allow,false);
});
it('preview RPC is privileged and rejects fabricated IDs',async()=>{
 assert.equal(buildPrivilegedMethods(handlers).has('signer_previewRequest'),true);
 await assert.rejects(handlers.get('signer_previewRequest')!({id:'fake',reveal:true}),/no longer/i);
 await assert.rejects(handlers.get('signer_previewRequest')!({id:'fake'}),/Invalid/i);
});

it('account switching prevents review with the previous account key',async()=>{
 const work=signer.handleNip44Encrypt(peer.pubkey,secret,site);void work.catch(()=>{});const request=await pending();
 await vault.setActiveAccount(peer.id);
 await assert.rejects(previewPendingRequest(request.id,true),/switched|session/i);
 await resolveRequest(request.id,{allow:false});await assert.rejects(work);
});

it('Advanced preserves the original post-quantum parameters without encrypting',async()=>{
 const opts={scheme:'pq' as const,recipientKemKey:'original recipient key'};
 const work=signer.handleNip44Encrypt(peer.pubkey,secret,site,opts);void work.catch(()=>{});
 opts.recipientKemKey='changed after request';const request=await pending();
 assert.deepEqual((await previewPendingRequest(request.id,false)).request.params.opts,{scheme:'pq',recipientKemKey:'original recipient key'});
 assert.equal((await previewPendingRequest(request.id,true)).plaintext,secret);
 await resolveRequest(request.id,{allow:false});await assert.rejects(work);
});
