import { beforeEach, afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import browser, { resetMockStorage } from './helpers/browser-mock.ts';
import * as vault from '../src/services/vault/vault.ts';
import * as permissions from '../src/services/permissions/permissions.ts';
import { addAllowedDomain } from '../src/services/background/domain-handlers.ts';
import { handleSignEvent } from '../src/services/signing/signer.ts';
import { getPending, resolveRequest, resolveBatch, cleanupStale } from '../src/services/signing/approvalQueue.ts';
import type { UnsignedEvent } from '../src/domain/nostr/types.ts';

const site = 'https://client.test';
const pubkey = 'dff1d77f2a671c5f36183726db2341be58feae1da2deced843240f7b502ba659';
const http = (url = 'https://api.test/login'): UnsignedEvent => ({ kind:27235, content:'', tags:[['u',url],['method','POST']],created_at:Math.floor(Date.now()/1000) });
const relay = (url = 'wss://relay.test/'): UnsignedEvent => ({ kind:22242, content:'', tags:[['relay',url],['challenge','random-connection-challenge']],created_at:Math.floor(Date.now()/1000) });
async function pending() {
  for (let i=0;i<60;i++) { const items=await getPending(); if(items.length) { await new Promise(r=>setTimeout(r,5)); return items; } await new Promise(r=>setTimeout(r,5)); }
  return [];
}
beforeEach(async()=>{
  vault.lock(); resetMockStorage(); permissions.invalidateCache(); await cleanupStale();
  await vault.create('testpassword123',{accounts:[{id:'acct1',name:'Test',type:'nsec',pubkey,privkey:'b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef',mnemonic:null,nip46Config:null,readOnly:false,createdAt:1}],activeAccountId:'acct1'});
  await browser.storage.local.set({activeAccountId:'acct1',accounts:[{id:'acct1',type:'nsec',pubkey}]});
  await browser.storage.sync.set({myPubkey:pubkey});
  await addAllowedDomain(site); await permissions.save(site,'signEvent',null,'allow','acct1');
});
afterEach(async()=>{vault.lock();await cleanupStale();});
it('broad signing permission cannot silently authorize another HTTP origin',async()=>{
  const signing=handleSignEvent(http(),site); void signing.catch(()=>{});
  const items=await pending();
  assert.equal(items.length,1,'cross-origin authentication must await destination consent');
  await resolveRequest(items[0].id,{allow:false}); await assert.rejects(signing,/denied/i);
});
it('broad signing permission cannot silently authenticate to a relay',async()=>{
  const signing=handleSignEvent(relay(),site); void signing.catch(()=>{});
  const items=await pending(); assert.equal(items.length,1);
  await resolveRequest(items[0].id,{allow:false}); await assert.rejects(signing,/denied/i);
});
it('same-origin HTTP requests preserve the normal authentication permission',async()=>{
  const result=await handleSignEvent(http(site+'/login'),site); assert.equal(result.kind,27235); assert.equal((await getPending()).length,0);
});
it('malformed authentication is rejected even with broad permissions',async()=>{
  for(const event of [
    {...http(),tags:[['u','https://api.test'],['u','https://evil.test'],['method','GET']]},
    {...http(),tags:[['u','https://api.test']]},
    http('https://api.test/\nlogin'), http('https://api.test/\\login'), http('http://api.test/login'),
    http('https://user:password@api.test/login'), http('javascript:alert(1)'), http('https://api.test/#fragment'),
    {...relay(),tags:[['relay','wss://relay.test/']]},
    {...relay(),tags:[['relay','wss://relay.test/'],['challenge','a'],['challenge','b']]},
    relay('ws://relay.test/'), {...http(),created_at:1},
  ]) await assert.rejects(handleSignEvent(event,site),/authentication/i);
});
it('batch approval cannot bypass explicit destination approval',async()=>{
  const signing=handleSignEvent(http(),site); void signing.catch(()=>{});
  const items=await pending(); assert.equal(items.length,1);
  await resolveBatch(site,items[0].permKey!,{allow:true,remember:true});
  assert.equal((await getPending()).length,1);
  await assert.rejects(resolveRequest(items[0].id,{allow:true}),/authentication/i);
  await resolveRequest(items[0].id,{allow:false}); await assert.rejects(signing,/denied/i);
});

it('one-time consent signs the reviewed URL but creates no standing grant',async()=>{
  const {listAuthenticationGrants}=await import('../src/services/permissions/authentication.ts');
  const event=http(); const signing=handleSignEvent(event,site); void signing.catch(()=>{});
  event.tags[0][1]='https://attacker.test';
  const [item]=await pending(); assert.equal(item.authentication?.url,'https://api.test/login');
  await resolveRequest(item.id,{allow:true,authenticationScope:'once'});
  const signed=await signing; assert.equal(signed.tags[0][1],'https://api.test/login');
  assert.deepEqual(await listAuthenticationGrants(),[]);
});
it('HTTP grants bind account, exact requesting origin, destination and method',async()=>{
  const {hasAuthenticationGrant}=await import('../src/services/permissions/authentication.ts');
  const {parseAuthentication}=await import('../src/domain/signing/authentication.ts');
  const signing=handleSignEvent(http(),site); void signing.catch(()=>{});
  const [item]=await pending(); await resolveRequest(item.id,{allow:true,authenticationScope:'site'}); await signing;
  assert.equal(await hasAuthenticationGrant('acct1',site,parseAuthentication(http(),site)!),true);
  assert.equal(await hasAuthenticationGrant('acct2',site,parseAuthentication(http(),site)!),false);
  assert.equal(await hasAuthenticationGrant('acct1','https://other.test',parseAuthentication(http(),site)!),false);
  assert.equal(await hasAuthenticationGrant('acct1',site,parseAuthentication(http('https://api.test:8443/login'),site)!),false);
  const get={...http(),tags:[['u','https://api.test/login'],['method','GET']]};
  assert.equal(await hasAuthenticationGrant('acct1',site,parseAuthentication(get,site)!),false);
  assert.equal((await handleSignEvent(http('https://api.test/other-path'),site)).kind,27235);
});
it('HTTP authentication never offers a shared-sites grant',async()=>{
  const signing=handleSignEvent(http(),site); void signing.catch(()=>{});
  const [item]=await pending(); await assert.rejects(resolveRequest(item.id,{allow:true,authenticationScope:'connected-sites'}),/authentication/i);
  await resolveRequest(item.id,{allow:false}); await assert.rejects(signing);
});
it('relay-wide consent works across connected websites only and deny still wins',async()=>{
  const other='https://other.test';
  const signing=handleSignEvent(relay(),site); void signing.catch(()=>{});
  const [item]=await pending(); await resolveRequest(item.id,{allow:true,authenticationScope:'connected-sites'}); await signing;
  await assert.rejects(handleSignEvent(relay(),other),/not connected/i);
  await addAllowedDomain(other);
  assert.equal((await handleSignEvent(relay(),other)).kind,22242);
  await permissions.save(other,'signEvent',22242,'deny','acct1');
  await assert.rejects(handleSignEvent(relay(),other),/denied/i);
});
it('relay grants preserve relay path, port and account boundaries',async()=>{
  const {hasAuthenticationGrant}=await import('../src/services/permissions/authentication.ts');
  const {parseAuthentication}=await import('../src/domain/signing/authentication.ts');
  const signing=handleSignEvent(relay('wss://relay.test/team-a'),site); void signing.catch(()=>{});
  const [item]=await pending(); await resolveRequest(item.id,{allow:true,authenticationScope:'connected-sites'}); await signing;
  for (const url of ['wss://relay.test/team-b','wss://relay.test:8443/team-a','wss://relay.test/team-a?tenant=b']) {
    assert.equal(await hasAuthenticationGrant('acct1',site,parseAuthentication(relay(url),site)!),false);
  }
  assert.equal(await hasAuthenticationGrant('acct2',site,parseAuthentication(relay('wss://relay.test/team-a'),site)!),false);
});
it('disconnect and account removal revoke authentication grants',async()=>{
  const {removeAllowedDomain}=await import('../src/services/background/domain-handlers.ts');
  const {listAuthenticationGrants}=await import('../src/services/permissions/authentication.ts');
  const signing=handleSignEvent(http(),site); void signing.catch(()=>{});
  const [item]=await pending(); await resolveRequest(item.id,{allow:true,authenticationScope:'site'}); await signing;
  await removeAllowedDomain(site); assert.deepEqual(await listAuthenticationGrants(),[]);
  await addAllowedDomain(site);
  const signingRelay=handleSignEvent(relay(),site); void signingRelay.catch(()=>{});
  const [relayItem]=await pending(); await resolveRequest(relayItem.id,{allow:true,authenticationScope:'connected-sites'}); await signingRelay;
  await permissions.clearForAccount('acct1'); assert.deepEqual(await listAuthenticationGrants(),[]);
});
it('revoking a saved grant makes the next request ask again',async()=>{
  const {listAuthenticationGrants,revokeAuthenticationGrants}=await import('../src/services/permissions/authentication.ts');
  const signing=handleSignEvent(relay(),site); void signing.catch(()=>{});
  const [item]=await pending(); await resolveRequest(item.id,{allow:true,authenticationScope:'site'}); await signing;
  await revokeAuthenticationGrants({id:(await listAuthenticationGrants())[0].id});
  const again=handleSignEvent(relay(),site); void again.catch(()=>{});
  const [next]=await pending(); assert.ok(next); await resolveRequest(next.id,{allow:false}); await assert.rejects(again);
});
it('a remote signer cannot bypass local destination consent',async()=>{
  const payload=vault.getAccountById('acct1')!;
  await browser.storage.local.set({accounts:[{...payload,type:'nip46'}]});
  const signing=handleSignEvent(relay(),site); void signing.catch(()=>{});
  const [item]=await pending(); assert.equal(item.authentication?.protocol,'nip42');
  await resolveRequest(item.id,{allow:false}); await assert.rejects(signing,/denied/i);
});
it('disconnect while approval is open prevents signing and remembered permission',async()=>{
  const {removeAllowedDomain}=await import('../src/services/background/domain-handlers.ts');
  const {listAuthenticationGrants}=await import('../src/services/permissions/authentication.ts');
  const signing=handleSignEvent(http(),site); void signing.catch(()=>{});
  const [item]=await pending(); await removeAllowedDomain(site);
  await resolveRequest(item.id,{allow:true,authenticationScope:'site'});
  await assert.rejects(signing,/not connected/i); assert.deepEqual(await listAuthenticationGrants(),[]);
});
it('revocation while waiting for unlock also blocks same-origin HTTP grants',async()=>{
  const {listAuthenticationGrants,revokeAuthenticationGrants}=await import('../src/services/permissions/authentication.ts');
  const {onVaultUnlocked}=await import('../src/services/signing/approvalQueue.ts');
  await permissions.save(site,'signEvent',null,'ask','acct1');
  const first=handleSignEvent(http(site+'/login'),site); void first.catch(()=>{});
  const [item]=await pending(); await resolveRequest(item.id,{allow:true,authenticationScope:'site'}); await first;
  vault.lock(); await cleanupStale();
  const signing=handleSignEvent(http(site+'/login'),site); void signing.catch(()=>{});
  const [waiting]=await pending(); assert.equal(waiting.waitingForUnlock,true);
  await revokeAuthenticationGrants({id:(await listAuthenticationGrants())[0].id});
  await vault.unlock('testpassword123'); await onVaultUnlocked();
  await assert.rejects(signing,/revoked/i);
});
it('concurrent remembered destinations survive serialized storage writes',async()=>{
  const {listAuthenticationGrants}=await import('../src/services/permissions/authentication.ts');
  const first=handleSignEvent(http('https://api-a.test/login'),site); void first.catch(()=>{});
  const second=handleSignEvent(http('https://api-b.test/login'),site); void second.catch(()=>{});
  for(let i=0;i<60 && (await getPending()).length<2;i++) await new Promise(r=>setTimeout(r,5));
  const items=await pending(); assert.equal(items.length,2);
  await Promise.all(items.map(item=>resolveRequest(item.id,{allow:true,authenticationScope:'site'})));
  await Promise.all([first,second]); assert.equal((await listAuthenticationGrants()).length,2);
});
it('an account switch while approving rejects the event and saves no grant',async()=>{
  const {listAuthenticationGrants}=await import('../src/services/permissions/authentication.ts');
  const signing=handleSignEvent(relay(),site); void signing.catch(()=>{});
  const [item]=await pending(); await browser.storage.local.set({activeAccountId:'different'});
  await resolveRequest(item.id,{allow:true,authenticationScope:'connected-sites'});
  await assert.rejects(signing,/Account switched/i); assert.deepEqual(await listAuthenticationGrants(),[]);
});
it('auth metadata preserves original URL but canonicalizes equivalent permission origins',async()=>{
  const {parseAuthentication}=await import('../src/domain/signing/authentication.ts');
  const auth=parseAuthentication(http('https://API.TEST:443/login?x=%2F'),site)!;
  assert.equal(auth.destination,'https://api.test'); assert.equal(auth.url,'https://API.TEST:443/login?x=%2F');
  assert.equal(parseAuthentication(relay('wss://RELAY.TEST:443'),site)!.destination,'wss://relay.test/');
  assert.equal(parseAuthentication({...http(),kind:1},site),undefined);
});
it('permission management RPCs revoke exactly the requested grant and reject empty IDs',async()=>{
  const {handlers}=await import('../src/services/background/nip07-handlers.ts');
  const signing=handleSignEvent(relay(),site); void signing.catch(()=>{});
  const [item]=await pending(); await resolveRequest(item.id,{allow:true,authenticationScope:'site'}); await signing;
  const grants=await handlers.get('signer_getAuthenticationGrants')!({}) as Array<{id:string}>;
  assert.equal(grants.length,1);
  await assert.rejects(handlers.get('signer_revokeAuthenticationGrant')!({id:''}));
  await handlers.get('signer_revokeAuthenticationGrant')!({id:grants[0].id});
  assert.deepEqual(await handlers.get('signer_getAuthenticationGrants')!({}),[]);
});
