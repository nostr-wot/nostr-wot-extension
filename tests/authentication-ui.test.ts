import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AuthenticationNotice from '../src/components/AuthenticationNotice';
import AuthenticationActions from '../src/components/AuthenticationActions';
const authentication = { protocol:'nip98' as const,url:'https://backend.test/login',destination:'https://backend.test',method:'POST',crossOrigin:true };
it('HTTP authentication review shows one exact URL and method without duplicate site or public key',()=>{
 const html=renderToStaticMarkup(createElement(AuthenticationNotice,{request:{origin:'https://client.test',pubkey:'a'.repeat(64),authentication}}));
 for(const text of ['auth.httpSummary','https://backend.test/login','POST','auth.crossOrigin']) assert.ok(html.includes(text));
 assert.ok(!html.includes('https://client.test')); assert.ok(!html.includes('a'.repeat(64)));
 assert.equal(html.split(authentication.url).length-1,1);
});
it('mounted HTTP actions offer only once and site scopes; relay adds explicit connected-sites consent',async()=>{
 const {JSDOM}=await import('jsdom'); const dom=new JSDOM('<div id="root"></div>',{url:'https://extension.test'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const {createRoot}=await import('react-dom/client'); const root=createRoot(document.getElementById('root')!); const scopes:string[]=[];
 try {
  await act(async()=>root.render(createElement(AuthenticationActions,{authentication,onApprove:scope=>scopes.push(scope),onDeny(){}})));
  assert.ok(!document.body.textContent!.includes('auth.connectedSites'));
  await act(async()=>{(document.querySelector('button') as HTMLButtonElement).click();}); assert.deepEqual(scopes,['once']);
  await act(async()=>root.render(createElement(AuthenticationActions,{authentication:{...authentication,protocol:'nip42'},onApprove:scope=>scopes.push(scope),onDeny(){}})));
  assert.ok(document.body.textContent!.includes('auth.connectedWarning'));
  const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='auth.connectedSites')!;
  await act(async()=>button.click()); assert.deepEqual(scopes,['once','connected-sites']);
 } finally {await act(async()=>root.unmount());dom.window.close();}
});
it('collapsed card shows the site once and authentication destination without a public key',async()=>{
 const {default:Card}=await import('../src/screens/Approval/ApprovalCard');
 const html=renderToStaticMarkup(createElement(Card,{group:{origin:'https://client.test',method:'signEvent',permKey:'auth',requests:[{id:'a',type:'signEvent',origin:'https://client.test',pubkey:'b'.repeat(64),authentication,timestamp:0}]},onClick(){}}));
 assert.ok(html.includes(authentication.url));assert.ok(!html.includes('b'.repeat(64)));
 assert.equal((html.match(/>https:\/\/client.test</g)||[]).length,1);
});
it('authentication detail cannot expose generic always-allow controls',async()=>{
 const {default:Detail}=await import('../src/components/EventDetailModal');
 const html=renderToStaticMarkup(createElement(Detail,{request:{type:'signEvent',origin:'https://client.test',authentication},onApprove(){},onAlwaysAllow(){},onAuthenticate(){},onDeny(){}}));
 assert.ok(html.includes('auth.once')); assert.ok(!html.includes('approval.alwaysAllow'));assert.ok(!html.includes('approval.approveOnce'));
});
it('mounted permissions filters accounts and retains failed revocations until success',async t=>{
 const {JSDOM}=await import('jsdom');const {default:Permissions}=await import('../src/screens/Settings/AuthenticationPermissions');
 const {default:browser}=await import('./helpers/browser-mock');
 const dom=new JSDOM('<div id="root"></div>',{url:'https://extension.test'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const {createRoot}=await import('react-dom/client'); const root=createRoot(document.getElementById('root')!);
 let fail=true;let grants=[{id:'ours',accountId:'a',origin:'*',protocol:'nip42',destination:'wss://ours.test/'},{id:'theirs',accountId:'b',origin:'*',protocol:'nip42',destination:'wss://theirs.test/'}];const revoked:string[]=[];
 t.mock.method(browser.runtime,'sendMessage',async(message:any)=>{
  if(message.method==='signer_getAuthenticationGrants')return {result:grants};
  if(message.method==='signer_revokeAuthenticationGrant'){revoked.push(message.params.id);if(fail)return {error:'Offline'};grants=grants.filter(g=>g.id!==message.params.id);return {result:{ok:true}};}
  throw new Error(message.method);
 });
 try{
  await act(async()=>root.render(createElement(Permissions,{accounts:[{id:'a',pubkey:'a'.repeat(64)}],activeId:'a'})));
  assert.ok(document.body.textContent!.includes('wss://ours.test/'));assert.ok(!document.body.textContent!.includes('wss://theirs.test/'));
  await act(async()=>{(document.querySelector('button') as HTMLButtonElement).click();});
  assert.ok(document.body.textContent!.includes('approval.actionFailed'));assert.ok(document.body.textContent!.includes('wss://ours.test/'));
  fail=false;await act(async()=>{(document.querySelector('button') as HTMLButtonElement).click();});
  assert.deepEqual(revoked,['ours','ours']);assert.ok(document.body.textContent!.includes('auth.noGrants'));
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
it('authentication detail labels do not expose the internal JSON grouping key',async()=>{
 const {default:Detail}=await import('../src/components/EventDetailModal');
 const request={id:'a',type:'signEvent',origin:'https://client.test',authentication,permKey:JSON.stringify(['nip98',authentication.url,'POST'])};
 const html=renderToStaticMarkup(createElement(Detail,{request,requests:[request,{...request,id:'b'}],onAuthenticate(){},onDeny(){}}));
 assert.ok(html.includes('perm.httpAuth'));assert.ok(!html.includes('&quot;nip98&quot;'));
 assert.ok(!html.includes('approval.detail.signDesc'));
 assert.ok(html.includes('auth.httpSummary')); assert.ok(!html.includes('auth.account'));
 assert.ok(html.includes('https://client.test')); assert.ok(!html.includes('auth.requester'));
});
it('mounted sheet excludes authentication from bulk approval and resolves only reviewed IDs',async t=>{
 const {JSDOM}=await import('jsdom'); const {createRoot}=await import('react-dom/client');
 const {AccountProvider}=await import('../src/context/AccountContext');const {VaultProvider}=await import('../src/context/VaultContext');const {PermissionsProvider}=await import('../src/context/PermissionsContext');
 const {default:Overlay}=await import('../src/screens/Approval/ApprovalOverlay');const {default:browser}=await import('./helpers/browser-mock');
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const originalMessages=browser.runtime.onMessage;
 Object.defineProperty(browser.runtime,'onMessage',{configurable:true,value:{addListener(){},removeListener(){}}});
 t.after(()=>Object.defineProperty(browser.runtime,'onMessage',{configurable:true,value:originalMessages}));
 const account={id:'auth-test',type:'imported',pubkey:'11'.repeat(32),name:'Test'};
 await browser.storage.local.set({accounts:[account],activeAccountId:account.id,profileCache:{}});
 const auth={id:'auth',accountId:account.id,pubkey:account.pubkey,origin:'https://client.test',type:'signEvent',permKey:JSON.stringify(['nip98',authentication.url,'POST']),needsPermission:true,authentication};
 let pending:any[]=[auth,{...auth,id:'ordinary',authentication:undefined,permKey:'signEvent:1'}]; const calls:any[]=[];
 t.mock.method(browser.runtime,'sendMessage',async(message:any)=>{
  calls.push(message);if(message.method==='signer_getPending')return {result:pending};if(message.method==='vault_getState')return {result:{exists:true,locked:false}};
  if(message.method==='signer_getPermissionsRaw')return {result:{}};if(message.method==='signer_getUseGlobalDefaults')return {result:true};
  if(message.method==='signer_resolve')pending=pending.filter(item=>item.id!==message.params.id);return {result:null};
 });
 const root=createRoot(document.getElementById('root')!);const render=()=>createElement(AccountProvider,null,createElement(VaultProvider,null,createElement(PermissionsProvider,null,createElement(Overlay))));
 const button=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
 try{
  await act(async()=>root.render(render()));
  assert.ok(document.body.textContent!.includes('approval.pendingRequests'));
  assert.ok(document.body.textContent!.includes('auth.reviewHint'));
  assert.ok(button('approval.rejectAll'));
  await act(async()=>button('approval.approveOnce')!.click());
  assert.deepEqual(calls.filter(c=>c.method==='signer_resolve').map(c=>c.params.id),['ordinary']);
  assert.equal(button('approval.approveOnce'),undefined);assert.equal(button('approval.rejectAll'),undefined);
  assert.ok(button('auth.once'));
  assert.ok(!document.body.textContent!.includes('approval.pendingRequests'));
  assert.ok(!document.body.textContent!.includes('auth.reviewHint'));
  pending.push({...auth,id:'late'});
  await act(async()=>button('auth.site')!.click());
  assert.deepEqual(calls.filter(c=>c.method==='signer_resolve').map(c=>c.params),[{id:'ordinary',decision:{allow:true,remember:false}},{id:'auth',decision:{allow:true,remember:false,authenticationScope:'site'}}]);
  assert.ok(!calls.some(c=>c.method==='signer_savePermission'||c.method==='signer_resolveBatch'));
  await act(async()=>button('approval.deny')!.click());assert.equal(pending.length,0);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
it('known backend hints require an exact registry origin pair and never hide cross-origin notice',async()=>{
 const {default:clients}=await import('../src/data/auth-clients.json');
 const client=clients.find(client=>client.backends.some(backend=>backend.auth==='nip98'))!;
 assert.ok(client,'registry includes an evidence-backed HTTP auth backend');
 const backend=client.backends.find(backend=>backend.auth==='nip98')!;
 const render=(origin:string,destination:string)=>renderToStaticMarkup(createElement(AuthenticationNotice,{request:{origin,pubkey:'a'.repeat(64),authentication:{...authentication,destination,url:destination+'/login'}}}));
 const known=render(client.origins[0],backend.origin);assert.ok(known.includes('auth.knownBackend'));assert.ok(known.includes('auth.crossOrigin'));
 assert.ok(!render(client.origins[0]+'.evil.test',backend.origin).includes('auth.knownBackend'));
 assert.ok(!render(client.origins[0],backend.origin+'.evil.test').includes('auth.knownBackend'));
});
it('grouped authentication labels explicitly disclose more than one request',()=>{
 const html=renderToStaticMarkup(createElement(AuthenticationActions,{authentication,requestCount:2,onApprove(){},onDeny(){}}));
 assert.ok(html.includes('auth.onceMany'));assert.ok(!html.includes('>auth.once<'));
});

it('relay review uses one host sentence without duplicate rows or identity warning',()=>{
 const html=renderToStaticMarkup(createElement(AuthenticationNotice,{request:{origin:'https://client.test',pubkey:'a'.repeat(64),authentication:{protocol:'nip42',destination:'wss://relay.damus.io/',url:'wss://relay.damus.io/',crossOrigin:true}}}));
 assert.ok(html.includes('auth.relaySummary')); assert.equal(html.split('relay.damus.io').length-1,1);
 for(const removed of ['auth.account','auth.requester','auth.destination','auth.resource','auth.relayNotice','auth.methods','a'.repeat(64),'https://client.test']) assert.ok(!html.includes(removed),removed);
});
it('relay sentence retains non-default port and endpoint and only shows specified methods',()=>{
 const html=renderToStaticMarkup(createElement(AuthenticationNotice,{request:{authentication:{protocol:'nip42',destination:'wss://relay.test:8443/private',url:'wss://relay.test:8443/private',method:'POST',crossOrigin:true}}}));
 assert.ok(html.includes('relay.test:8443/private'));assert.ok(html.includes('auth.methods'));assert.ok(html.includes('POST'));
});
for (const mode of ['auth', 'ordinary', 'nip46'] as const) {
 it(`one ${mode} request opens detail directly and keeps failed actions visible`,async t=>{
  const {JSDOM}=await import('jsdom'); const {createRoot}=await import('react-dom/client');
  const {AccountProvider}=await import('../src/context/AccountContext');const {VaultProvider}=await import('../src/context/VaultContext');const {PermissionsProvider}=await import('../src/context/PermissionsContext');
  const {default:Overlay}=await import('../src/screens/Approval/ApprovalOverlay');const {default:browser}=await import('./helpers/browser-mock');
  const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  const originalMessages=browser.runtime.onMessage;
  Object.defineProperty(browser.runtime,'onMessage',{configurable:true,value:{addListener(){},removeListener(){}}});
  t.after(()=>Object.defineProperty(browser.runtime,'onMessage',{configurable:true,value:originalMessages}));
  const account={id:'single-test',type:'imported',pubkey:'11'.repeat(32),name:'Test'};
  await browser.storage.local.set({accounts:[account],activeAccountId:account.id,profileCache:{}});
  let pending:any[]=[{id:'single',accountId:account.id,pubkey:account.pubkey,origin:'https://client.test',type:'signEvent',permKey:'signEvent:1',needsPermission:true,authentication:mode==='auth'?authentication:undefined,nip46InFlight:mode==='nip46'}];
  let fail=true;const decisions:string[]=[];
  t.mock.method(browser.runtime,'sendMessage',async(message:any)=>{
   if(message.method==='signer_getPending')return {result:pending};if(message.method==='vault_getState')return {result:{exists:true,locked:false}};
   if(message.method==='signer_getPermissionsRaw')return {result:{}};if(message.method==='signer_getUseGlobalDefaults')return {result:true};
   if(message.method==='signer_resolve'||message.method==='signer_cancelNip46'){
    if(fail)return {error:'Could not resolve'};decisions.push(message.params.id);pending=[];
   }return {result:null};
  });
  const root=createRoot(document.getElementById('root')!);
  const button=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
  try{
   await act(async()=>root.render(createElement(AccountProvider,null,createElement(VaultProvider,null,createElement(PermissionsProvider,null,createElement(Overlay))))));
   for(const key of ['approval.pendingRequests','approval.rejectAll','auth.reviewHint'])assert.ok(!document.body.textContent!.includes(key),key);
   assert.equal(document.querySelector('[aria-label="common.close"]'),null);
   const label=mode==='nip46'?'approval.cancelNip46':'approval.deny';assert.ok(button(label));
   await act(async()=>button(label)!.click());assert.ok(document.body.textContent!.includes('approval.actionFailed'));assert.ok(button(label));
   fail=false;await act(async()=>button(label)!.click());assert.deepEqual(decisions,['single']);assert.equal(document.body.textContent,'');
  }finally{await act(async()=>root.unmount());dom.window.close();}
 });
}
