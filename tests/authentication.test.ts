import { LEGACY_LOGIN_ORIGIN } from '../src/domain/signing/authentication.ts';
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
it('same-origin HTTP requests require endpoint consent despite broad signing permission',async()=>{
  const signing=handleSignEvent(http(site+'/login'),site); void signing.catch(()=>{});
  const [item]=await pending(); assert.ok(item);
  await resolveRequest(item.id,{allow:true,authenticationScope:'once'});
  assert.equal((await signing).kind,27235);
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
  for (const url of ['https://api.test/other-path','https://api.test/login?x=1','https://API.TEST/login']) {
    assert.equal(await hasAuthenticationGrant('acct1',site,parseAuthentication(http(url),site)!),false);
  }
  assert.equal((await handleSignEvent(http(),site)).kind,27235);
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
for (const accountType of ['nsec', 'nip46'] as const) {
  it(`identity disable while waiting for unlock blocks saved relay consent for ${accountType}`, async()=>{
    const {handlers:signingHandlers}=await import('../src/services/background/nip07-handlers.ts');
    const {handlers:domainHandlers}=await import('../src/services/background/domain-handlers.ts');
    const {saveAuthenticationGrant}=await import('../src/services/permissions/authentication.ts');
    const {parseAuthentication}=await import('../src/domain/signing/authentication.ts');
    const {onVaultUnlocked}=await import('../src/services/signing/approvalQueue.ts');
    if (accountType === 'nip46') {
      await vault.create('testpassword123',{accounts:[{id:'acct1',name:'Remote',type:'nip46',pubkey,privkey:null,mnemonic:null,nip46Config:null,readOnly:false,createdAt:1}],activeAccountId:'acct1'});
      await browser.storage.local.set({accounts:[{id:'acct1',type:'nip46',pubkey}]});
    }
    await saveAuthenticationGrant('acct1',site,parseAuthentication(relay(),site)!,'site',()=>{});
    vault.lock(); await cleanupStale();
    const signing=signingHandlers.get('nip07_signEvent')!({origin:site,event:relay()});
    void signing.catch(()=>{});
    const [waiting]=await pending(); assert.equal(waiting.waitingForUnlock,true);
    await domainHandlers.get('setIdentityDisabled')!({domain:site,disabled:true});
    await vault.unlock('testpassword123'); await onVaultUnlocked();
    await assert.rejects(signing,/Identity access disabled for this site/);
    assert.equal((await getPending()).some(request=>request.nip46InFlight),false);
  });
}
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

it('remembered rejection is scoped and overrides a shared relay allowance until revoked',async()=>{
  const {getAuthenticationDecision,saveAuthenticationGrant,revokeAuthenticationGrants,listAuthenticationGrants}=await import('../src/services/permissions/authentication.ts');
  const {parseAuthentication}=await import('../src/domain/signing/authentication.ts');
  const signing=handleSignEvent(relay(),site); void signing.catch(()=>{});
  const [item]=await pending();
  const auth=parseAuthentication(relay(),site)!;
  await saveAuthenticationGrant('acct1',site,auth,'connected-sites',()=>{});
  await resolveRequest(item.id,{allow:false,rememberAuthenticationDeny:true});
  await assert.rejects(signing,/denied/i);
  assert.equal(await getAuthenticationDecision('acct1',site,auth),'deny');
  assert.equal(await getAuthenticationDecision('acct2',site,auth),undefined);
  assert.equal(await getAuthenticationDecision('acct1','https://other.test',auth),'allow');
  assert.equal(await getAuthenticationDecision('acct1',site,{...auth,destination:'wss://another.test/'}),undefined);
  await assert.rejects(handleSignEvent(relay(),site),/denied/i);
  assert.equal((await getPending()).length,0);
  const denial=(await listAuthenticationGrants()).find(g=>g.decision==='deny')!;
  await revokeAuthenticationGrants({id:denial.id});
  assert.equal((await handleSignEvent(relay(),site)).kind,22242);
});
it('remembered HTTP rejection binds the method and overrides broad same-origin permission',async()=>{
  const {getAuthenticationDecision}=await import('../src/services/permissions/authentication.ts');
  await permissions.save(site,'signEvent',27235,'ask','acct1');
  const signing=handleSignEvent(http(site+'/login'),site); void signing.catch(()=>{});
  const [item]=await pending();
  await resolveRequest(item.id,{allow:false,rememberAuthenticationDeny:true});await assert.rejects(signing,/denied/i);
  await permissions.save(site,'signEvent',27235,'allow','acct1');
  await assert.rejects(handleSignEvent(http(site+'/login'),site),/denied/i);
  assert.equal(await getAuthenticationDecision('acct1',site,{...item.authentication!,url:site+'/other'}),undefined);
  assert.equal(await getAuthenticationDecision('acct1',site,{...item.authentication!,method:'GET'}),undefined);
});
it('failed remembered rejection stays pending and ordinary rejection does not persist',async t=>{
  const {listAuthenticationGrants}=await import('../src/services/permissions/authentication.ts');
  const signing=handleSignEvent(relay(),site); void signing.catch(()=>{}); const [item]=await pending();
  const original=browser.storage.local.set.bind(browser.storage.local);
  const mock=t.mock.method(browser.storage.local,'set',async(data:any)=>{if(data.authenticationGrants)throw new Error('storage failed');return original(data);});
  await assert.rejects(resolveRequest(item.id,{allow:false,rememberAuthenticationDeny:true}),/storage failed/);
  assert.equal((await getPending()).length,1); mock.mock.restore();
  await resolveRequest(item.id,{allow:false});await assert.rejects(signing,/denied/i);
  assert.deepEqual(await listAuthenticationGrants(),[]);
});

it('an approval waiting for the grant lock cannot overwrite a concurrent rejection',async()=>{
  const {saveAuthenticationGrant,getAuthenticationDecision}=await import('../src/services/permissions/authentication.ts');
  const {parseAuthentication}=await import('../src/domain/signing/authentication.ts');
  const auth=parseAuthentication(http(),site)!;
  const rejection=saveAuthenticationGrant('acct1',site,auth,'site',()=>{},'deny');
  const approval=saveAuthenticationGrant('acct1',site,auth,'site',()=>{});
  await rejection;await assert.rejects(approval,/denied/i);
  await assert.rejects(saveAuthenticationGrant('acct1',site,auth,'once',()=>{}),/denied/i);
  assert.equal(await getAuthenticationDecision('acct1',site,auth),'deny');
});
it('an account switch while a remembered rejection is being saved creates no rule',async t=>{
  const {listAuthenticationGrants}=await import('../src/services/permissions/authentication.ts');
  const signing=handleSignEvent(relay(),site);void signing.catch(()=>{});const [item]=await pending();
  const original=browser.storage.local.get.bind(browser.storage.local);
  const mock=t.mock.method(browser.storage.local,'get',async(key:any)=>{
    const result=await original(key);if(key==='authenticationGrants')vault.lock();return result;
  });
  await assert.rejects(resolveRequest(item.id,{allow:false,rememberAuthenticationDeny:true}),/locked|session|switched/i);
  await assert.rejects(signing,/locked/i);mock.mock.restore();assert.deepEqual(await listAuthenticationGrants(),[]);
});

it('legacy origin-wide HTTP allows ask again while legacy denies retain their scope',async()=>{
  const {getAuthenticationDecision,saveAuthenticationGrant}=await import('../src/services/permissions/authentication.ts');
  const {parseAuthentication}=await import('../src/domain/signing/authentication.ts');
  const grant={id:'legacy',accountId:'acct1',origin:site,protocol:'nip98',destination:'https://api.test',method:'POST'};
  for (const decision of [undefined,'allow','deny']) {
    await browser.storage.local.set({authenticationGrants:[{...grant,decision}]});
    for (const url of ['https://api.test/login','https://api.test/delete?confirm=1']) {
      const auth=parseAuthentication(http(url),site)!;
      assert.equal(await getAuthenticationDecision('acct1',site,auth),decision==='deny'?'deny':undefined);
      if (decision==='deny') await assert.rejects(saveAuthenticationGrant('acct1',site,auth,'site',()=>{}),/denied/i);
    }
  }
});
it('origin metadata cannot impersonate another website or contain duplicate claims',async()=>{
  for (const name of ['origin','client-origin']) {
    for (const tags of [[[name,'https://trusted.test']],[[name,site],[name,site]],[[name,site,'extra']]]) {
      await assert.rejects(handleSignEvent({...http(),tags:[...http().tags,...tags]},site),/origin/i);
    }
  }
});
it('native wallet capabilities cannot be signed through generic page authentication',async()=>{
  for (const origin of [site,'https://zaps.nostr-wot.com']) {
    for (const prefix of ['/api/','/api/v2/']) for (const operation of ['provision','claim-username','release-username']) {
      await assert.rejects(handleSignEvent(http('https://zaps.nostr-wot.com'+prefix+operation+'?ignored=1'),origin),/wallet/i);
    }
  }
});

it('matching origin metadata is preserved without becoming an attestation',async()=>{
  const request={...http(),tags:[...http().tags,['client-origin',site],['origin',site]]};
  const signing=handleSignEvent(request,site);void signing.catch(()=>{});
  const [item]=await pending();await resolveRequest(item.id,{allow:true,authenticationScope:'once'});
  assert.deepEqual((await signing).tags,request.tags);
});
it('omitted ordinary tags and timestamp are normalized before review',async()=>{
  await permissions.save(site,'signEvent',1,'ask','acct1');
  const signing=handleSignEvent({kind:1,content:'hello'} as UnsignedEvent,site);void signing.catch(()=>{});
  const [item]=await pending(); assert.deepEqual(item.event?.tags,[]);assert.ok(Number.isInteger(item.event?.created_at));
  await resolveRequest(item.id,{allow:true});const result=await signing;
  assert.equal(result.created_at,item.event?.created_at);assert.deepEqual(result.tags,item.event?.tags);
});
it('default backend authentication is opt-in, account-specific and never creates grants',async()=>{
 const {setDefaultBackendAuth,getDefaultBackendAuth,listAuthenticationGrants}=await import('../src/services/permissions/authentication');
 assert.equal(await getDefaultBackendAuth('acct1'),false);
 await setDefaultBackendAuth('acct1',true);
 assert.equal(await getDefaultBackendAuth('other'),false);
 const signed=await handleSignEvent(http(site+'/session?client=web'),site);
 assert.equal(signed.kind,27235);assert.equal((await getPending()).length,0);assert.deepEqual(await listAuthenticationGrants(),[]);
 await setDefaultBackendAuth('acct1',false);
 const signing=handleSignEvent(http(site+'/session'),site);void signing.catch(()=>{});
 const [request]=await pending();assert.ok(request);await resolveRequest(request.id,{allow:false});await assert.rejects(signing,/denied/i);
});
it('default backend authentication uses exact HTTPS NIP-98 registry pairs and preserves denials',async()=>{
 const {setDefaultBackendAuth,getAuthenticationDecision,saveAuthenticationGrant}=await import('../src/services/permissions/authentication');
 const {parseAuthentication}=await import('../src/domain/signing/authentication');
 await setDefaultBackendAuth('acct1',true);
 const auth=(url:string)=>parseAuthentication(http(url),site)!;
 assert.equal(await getAuthenticationDecision('acct1','https://nostria.app',auth('https://api.nostria.app/login')),'allow');
 for(const [origin,url] of [[site,'https://client.test.evil.test/login'],[site,'https://client.test:8443/login'],[site,'https://api.client.test/login'],['https://evil.test','https://api.nostria.app/login'],['https://nostria.app.evil.test','https://api.nostria.app/login'],['https://coracle.social','https://blossom.nostr.build/login']]){
  assert.equal(await getAuthenticationDecision('acct1',origin,auth(url)),undefined,origin+' -> '+url);
 }
 assert.equal(await getAuthenticationDecision('acct1',site,parseAuthentication(relay(),site)!),undefined);
 const target=auth(site+'/login');await saveAuthenticationGrant('acct1',site,target,'site',()=>{},'deny');
 assert.equal(await getAuthenticationDecision('acct1',site,target),'deny');
 await assert.rejects(handleSignEvent(http(site+'/login'),site),/denied/i);
});
it('default backend auth cannot bypass connection or identity restrictions',async()=>{
 const {setDefaultBackendAuth}=await import('../src/services/permissions/authentication');
 await setDefaultBackendAuth('acct1',true);
 await assert.rejects(handleSignEvent(http('https://unconnected.test/login'),'https://unconnected.test'),/not connected/i);
 await browser.storage.local.set({identityDisabledSites:[site]});
 await assert.rejects(handleSignEvent(http(site+'/login'),site),/identity.*disabled/i);
});
it('deleting an account clears its default backend policy and vault reset clears all policies',async()=>{
 const {setDefaultBackendAuth,getDefaultBackendAuth,revokeAuthenticationGrants}=await import('../src/services/permissions/authentication');
 await setDefaultBackendAuth('acct1',true);await setDefaultBackendAuth('other',true);
 await revokeAuthenticationGrants({accountId:'acct1'});
 assert.equal(await getDefaultBackendAuth('acct1'),false);assert.equal(await getDefaultBackendAuth('other'),true);
 await revokeAuthenticationGrants();assert.equal(await getDefaultBackendAuth('other'),false);
});
it('relay settings group scopes per account and atomically replace only one relay',async()=>{
 const {groupRelayPermissions,connectedSiteOrigins}=await import('../src/domain/signing/relayPermissions');
 const {saveAuthenticationGrant,setRelayAuthenticationSites,listAuthenticationGrants,getAuthenticationDecision}=await import('../src/services/permissions/authentication');
 const {parseAuthentication}=await import('../src/domain/signing/authentication');
 const {relayPermissionRevision}=await import('../src/domain/signing/relayPermissions');
 const revision=async()=>relayPermissionRevision(await listAuthenticationGrants(),'acct1','wss://relay.test/');
 const auth=parseAuthentication(relay(),site)!;const second='https://second.test';
 await addAllowedDomain(second);
 await saveAuthenticationGrant('acct1',site,auth,'connected-sites',()=>{});
 await saveAuthenticationGrant('acct1',second,auth,'site',()=>{},'deny');
 await saveAuthenticationGrant('acct2',site,auth,'site',()=>{});
 const httpAuth=parseAuthentication(http(),site)!;
 await saveAuthenticationGrant('acct1',site,httpAuth,'site',()=>{});
 let groups=groupRelayPermissions(await listAuthenticationGrants(),'acct1');
 assert.equal(groups.length,1);assert.equal(groups[0].allSites,true);assert.deepEqual(groups[0].deniedOrigins,[second]);
 await setRelayAuthenticationSites('acct1',auth.destination,[],true,()=>{},await revision());
 assert.equal(await getAuthenticationDecision('acct1',second,auth),'deny','all-sites save preserves denial');
 await setRelayAuthenticationSites('acct1',auth.destination,[second],false,()=>{},await revision());
 assert.equal(await getAuthenticationDecision('acct1',second,auth),'allow','explicit site selection replaces denial');
 assert.equal(await getAuthenticationDecision('acct1',site,auth),undefined,'unselected site must ask again');
 assert.equal(await getAuthenticationDecision('acct2',site,auth),'allow');
 assert.equal(await getAuthenticationDecision('acct1',site,httpAuth),'allow');
 groups=groupRelayPermissions(await listAuthenticationGrants(),'acct1');
 assert.deepEqual(groups[0].allowedOrigins,[second]);assert.equal(groups[0].allSites,false);
 assert.deepEqual(connectedSiteOrigins(['client.test','https://client.test','https://bad.test/path','javascript:bad','http://remote.test','http://localhost:4000']),['http://localhost:4000','https://client.test']);
});
it('relay settings reject disconnected apps, stale accounts and unknown destinations without altering grants',async()=>{
 const {saveAuthenticationGrant,setRelayAuthenticationSites,listAuthenticationGrants}=await import('../src/services/permissions/authentication');
 const {parseAuthentication}=await import('../src/domain/signing/authentication');
 const {relayPermissionRevision}=await import('../src/domain/signing/relayPermissions');
 const revision=async()=>relayPermissionRevision(await listAuthenticationGrants(),'acct1','wss://relay.test/');
 const auth=parseAuthentication(relay(),site)!;
 await saveAuthenticationGrant('acct1',site,auth,'site',()=>{});
 const before=await listAuthenticationGrants();
 await assert.rejects(setRelayAuthenticationSites('acct1',auth.destination,['https://unconnected.test'],false,()=>{},await revision()),/not connected/);
 await assert.rejects(setRelayAuthenticationSites('acct1',auth.destination,[site],false,()=>{throw new Error('Account switched');},await revision()),/Account switched/);
 await assert.rejects(setRelayAuthenticationSites('acct1','wss://unknown.test/',[site],false,()=>{},await revision()),/no longer exists/);
 await assert.rejects(setRelayAuthenticationSites('acct1',auth.destination,[site],true,()=>{},await revision()),/Choose/);
 assert.deepEqual(await listAuthenticationGrants(),before);
 const stale=await revision();
 await saveAuthenticationGrant('acct1',site,auth,'site',()=>{},'deny');
 await assert.rejects(setRelayAuthenticationSites('acct1',auth.destination,[site],false,()=>{},stale),/permissions changed/);
});

it('relay settings revoke all allows while locked and reject an inactive account',async()=>{
 const {handlers}=await import('../src/services/background/nip07-handlers');
 const {saveAuthenticationGrant,listAuthenticationGrants}=await import('../src/services/permissions/authentication');
 const {parseAuthentication}=await import('../src/domain/signing/authentication');
 const {relayPermissionRevision}=await import('../src/domain/signing/relayPermissions');
 const auth=parseAuthentication(relay(),site)!;
 await saveAuthenticationGrant('acct1',site,auth,'connected-sites',()=>{});
 await saveAuthenticationGrant('acct1','https://blocked.test',auth,'site',()=>{},'deny');
 const before=await listAuthenticationGrants();
 const params={accountId:'acct1',destination:auth.destination,origins:[],allSites:false,revision:relayPermissionRevision(before,'acct1',auth.destination)};
 vault.lock();
 await browser.storage.local.set({activeAccountId:'other'});
 await assert.rejects(handlers.get('signer_setRelayAuthenticationSites')!(params),/Account switched/);
 assert.deepEqual(await listAuthenticationGrants(),before);
 await browser.storage.local.set({activeAccountId:'acct1'});
 await handlers.get('signer_setRelayAuthenticationSites')!(params);
 assert.deepEqual(await listAuthenticationGrants(),before.filter(grant=>grant.decision==='deny'));
});

it('all-site global signing approvals still require backend and relay destination consent', async () => {
  await permissions.migrateToGlobalRules();
  await permissions.clearRuleBucket(site);
  await permissions.saveDirect('_global', 'signEvent', 'allow');
  for (const event of [http(), relay()]) {
    const signing = handleSignEvent(event, site); void signing.catch(() => {});
    const [item] = await pending();
    assert.ok(item?.authentication, 'global signing defaults must not authorize authentication');
    await resolveRequest(item.id, {allow:false});
    await assert.rejects(signing, /denied/i);
  }
});

const legacySite = LEGACY_LOGIN_ORIGIN;
const legacyHost = new URL(legacySite).hostname;
const legacyLogin = (): UnsignedEvent => ({kind:22242,content:'',created_at:Math.floor(Date.now()/1000),tags:[['domain',legacyHost],['challenge','login-challenge']]});
it('legacy website login requires individual consent every time and signs the original event', async () => {
  const {setDefaultBackendAuth,listAuthenticationGrants}=await import('../src/services/permissions/authentication');
  await addAllowedDomain(legacySite);
  await permissions.save(legacySite,'signEvent',null,'allow','acct1');
  await setDefaultBackendAuth('acct1',true);
  for (let n=0;n<2;n++) {
    const event=legacyLogin();const signing=handleSignEvent(event,legacySite);void signing.catch(()=>{});
    const [item]=await pending();assert.equal(item.authentication?.protocol,'legacy-login');
    await resolveBatch(legacySite,item.permKey!,{allow:true});assert.equal((await getPending()).length,1);
    for (const scope of ['site','connected-sites'] as const) await assert.rejects(resolveRequest(item.id,{allow:true,authenticationScope:scope}),/authentication/i);
    await assert.rejects(resolveRequest(item.id,{allow:false,rememberAuthenticationDeny:true}),/scope/i);
    await resolveRequest(item.id,{allow:true,authenticationScope:'once'});
    const signed=await signing;
    assert.deepEqual(signed.tags,event.tags);assert.equal(signed.kind,event.kind);assert.equal(signed.created_at,event.created_at);assert.equal(signed.content,event.content);
    assert.deepEqual(await listAuthenticationGrants(),[]);
  }
});
it('legacy login rejects unknown clients, spoofed domains and ambiguous or stale formats', async () => {
  const {parseAuthentication}=await import('../src/domain/signing/authentication');
  for (const origin of [site,`http://${legacyHost}`,`${legacySite}:8443`,`${legacySite}.evil.test`,`https://www.${legacyHost}`,`${legacySite}/`]) {
    assert.throws(()=>parseAuthentication(legacyLogin(),origin),/authentication/i);
  }
  for (const tags of [
    [['domain','evil.test'],['challenge','x']],
    [['domain',legacyHost],['domain',legacyHost],['challenge','x']],
    [['domain',legacyHost],['challenge','x'],['challenge','y']],
    [['domain',legacyHost],['challenge',' ']],
    [['domain',legacyHost],['challenge','x','extra']],
    [['domain',legacyHost]],
    [...legacyLogin().tags,['relay','']],
    [...legacyLogin().tags,['u','https://evil.test']],
    [...legacyLogin().tags,['method','POST']],
    [...legacyLogin().tags,['origin','https://evil.test']],
  ]) assert.throws(()=>parseAuthentication({...legacyLogin(),tags},legacySite),/authentication/i);
  for (const delta of [-61,61]) assert.throws(()=>parseAuthentication({...legacyLogin(),created_at:Math.floor(Date.now()/1000)+delta},legacySite),/timestamp/i);
  assert.throws(()=>parseAuthentication({...legacyLogin(),content:'hidden'},legacySite),/content/i);
  await assert.rejects(handleSignEvent(legacyLogin(),legacySite),/not connected/i);
});
it('legacy login cannot inherit grants and denial does not sign', async () => {
  const {parseAuthentication}=await import('../src/domain/signing/authentication');
  const {getAuthenticationDecision}=await import('../src/services/permissions/authentication');
  const auth=parseAuthentication(legacyLogin(),legacySite)!;
  await browser.storage.local.set({authenticationGrants:[{id:'forged',accountId:'acct1',origin:legacySite,protocol:'legacy-login',destination:legacySite,version:2,resource:legacySite}]});
  assert.equal(await getAuthenticationDecision('acct1',legacySite,auth),undefined);
  await addAllowedDomain(legacySite);
  const signing=handleSignEvent(legacyLogin(),legacySite);void signing.catch(()=>{});
  const [item]=await pending();await resolveRequest(item.id,{allow:false});await assert.rejects(signing,/denied/i);
});
