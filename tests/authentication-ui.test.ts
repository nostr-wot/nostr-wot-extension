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
  assert.ok(!document.body.textContent!.includes('auth.connectedWarning'));
  await act(async()=>{(document.querySelector('[aria-label="approval.approveOptions"]') as HTMLButtonElement).click();});
  const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='auth.approveAllSites')!;
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
 assert.ok(html.includes('approval.approve')); assert.ok(!html.includes('approval.alwaysAllow'));assert.ok(html.includes('event.showRaw'));
 assert.ok(!html.includes('<details open'));
});
it('mounted permissions filters accounts and retains failed revocations until success',async t=>{
 const {JSDOM}=await import('jsdom');const {default:Permissions}=await import('../src/screens/Settings/AuthenticationPermissions');
 const {default:browser}=await import('./helpers/browser-mock');
 const dom=new JSDOM('<div id="root"></div>',{url:'https://extension.test'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const {createRoot}=await import('react-dom/client'); const root=createRoot(document.getElementById('root')!);
 let fail=true;let grants=[{id:'ours',accountId:'a',origin:'https://site.test',protocol:'nip98',destination:'https://ours.test/'},{id:'theirs',accountId:'b',origin:'https://site.test',protocol:'nip98',destination:'https://theirs.test/'}];const revoked:string[]=[];
 t.mock.method(browser.runtime,'sendMessage',async(message:any)=>{
  if(message.method==='signer_getAuthenticationGrants')return {result:grants};
  if(message.method==='signer_revokeAuthenticationGrant'){revoked.push(message.params.id);if(fail)return {error:'Offline'};grants=grants.filter(g=>g.id!==message.params.id);return {result:{ok:true}};}
  throw new Error(message.method);
 });
 try{
  await act(async()=>root.render(createElement(Permissions,{accounts:[{id:'a',pubkey:'a'.repeat(64)}],activeId:'a'})));
  assert.ok(document.body.textContent!.includes('https://ours.test/'));assert.ok(!document.body.textContent!.includes('https://theirs.test/'));
  await act(async()=>{(document.querySelector('button') as HTMLButtonElement).click();});
  assert.ok(document.body.textContent!.includes('approval.actionFailed'));assert.ok(document.body.textContent!.includes('https://ours.test/'));
  fail=false;await act(async()=>{(document.querySelector('button') as HTMLButtonElement).click();});
  assert.deepEqual(revoked,['ours','ours']);assert.ok(document.body.textContent!.includes('auth.backendNoGrants'));
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
  assert.equal(button('approval.rejectAll'),undefined);
  assert.ok(button('approval.approve'));
  assert.ok(!document.body.textContent!.includes('approval.pendingRequests'));
  assert.ok(!document.body.textContent!.includes('auth.reviewHint'));
  pending.push({...auth,id:'late'});
  await act(async()=>{(document.querySelector('[aria-label="approval.approveOptions"]') as HTMLButtonElement).click();});
  await act(async()=>button('auth.approveAlways')!.click());
  assert.deepEqual(calls.filter(c=>c.method==='signer_resolve').map(c=>c.params),[{id:'ordinary',decision:{allow:true,remember:false}},{id:'auth',decision:{allow:true,remember:false,authenticationScope:'site'}}]);
  assert.ok(!calls.some(c=>c.method==='signer_savePermission'||c.method==='signer_resolveBatch'));
  await act(async()=>button('auth.reject')!.click());assert.equal(pending.length,0);
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
 assert.ok(html.includes('approval.approveShown'));assert.ok(!html.includes('>approval.approveOnce<'));
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
   const label=mode==='nip46'?'approval.cancelNip46':mode==='auth'?'auth.reject':'approval.deny';assert.ok(button(label));
   await act(async()=>button(label)!.click());assert.ok(document.body.textContent!.includes('approval.actionFailed'));assert.ok(button(label));
   fail=false;await act(async()=>button(label)!.click());assert.deepEqual(decisions,['single']);assert.equal(document.body.textContent,'');
  }finally{await act(async()=>root.unmount());dom.window.close();}
 });
}

it('advanced event data is collapsed and reject-always is available only through its menu',async()=>{
 const {JSDOM}=await import('jsdom');const {createRoot}=await import('react-dom/client');const {default:Detail}=await import('../src/components/EventDetailModal');
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(document.getElementById('root')!);let rejected=0;
 try{
  await act(async()=>root.render(createElement(Detail,{request:{type:'signEvent',authentication,event:{kind:27235,content:'',tags:[['u',authentication.url],['method','POST']]}},onAuthenticate(){},onDeny(){},onAlwaysDeny(){rejected++;}})));
  const rawButton=document.querySelector('[aria-label="event.showRaw"]') as HTMLButtonElement;
  assert.ok(rawButton);assert.equal(document.querySelector('[role="dialog"]'),null);
  rawButton.focus();await act(async()=>rawButton.click());
  const popup=document.querySelector('[role="dialog"]')!;assert.ok(popup.textContent?.includes('POST'));
  await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(document.querySelector('[role="dialog"]'),null);assert.equal(document.activeElement,rawButton);
  assert.equal(document.querySelector('[role="menu"]'),null);
  await act(async()=>{(document.querySelector('[aria-label="approval.rejectOptions"]') as HTMLButtonElement).click();});
  const choice=document.querySelector('[role="menuitem"]') as HTMLButtonElement;
  assert.equal(choice.textContent,'auth.rejectAlways');await act(async()=>choice.click());assert.equal(rejected,1);
  assert.equal(document.querySelector('[role="menu"]'),null);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});

it('every known signing kind uses a description and collapsed raw event without a kind table',async()=>{
 const {default:Detail}=await import('../src/components/EventDetailModal');
 const {KIND_LABELS}=await import('../src/constants/nostr');const {JSDOM}=await import('jsdom');
 for(const kind of [...Object.keys(KIND_LABELS).map(Number),55555]){
  const event={kind,content:'original content',tags:[['d','Primal-Web App','get_app_subsettings_home']]};
  const html=renderToStaticMarkup(createElement(Detail,{request:{id:'request',type:'signEvent',origin:'https://primal.net',event},onApprove(){}}));
  const dom=new JSDOM(html);
  assert.ok(dom.window.document.querySelector('button[aria-haspopup="dialog"]'),`Raw popup trigger exists for ${kind}`);
  assert.ok(!dom.window.document.body.textContent!.includes('event.kind'));
  assert.ok(!dom.window.document.querySelector('details'));dom.window.close();
 }
});
it('grouped event selection approves only checked IDs and leaves late arrivals unchecked',async()=>{
 const {default:Detail}=await import('../src/components/EventDetailModal');const {JSDOM}=await import('jsdom');const {createRoot}=await import('react-dom/client');
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const requests=['one','two'].map((id,i)=>({id,type:'signEvent',origin:'site',event:{kind:30078,content:'',tags:[['d','Primal-Web App',i?'reset_direct_message_count':'get_app_subsettings_home']]}}));
 const chosen:string[][]=[];let rejected=0;const root=createRoot(document.getElementById('root')!);
 const render=()=>createElement(Detail,{request:requests[0],requests:[...requests],onApproveSelected:ids=>chosen.push(ids),onDeny:()=>rejected++});
 try{
  await act(async()=>root.render(render()));
  const approve=()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='approval.approveSelected')!;
  assert.equal(approve().disabled,true);
  assert.equal(document.querySelectorAll('[data-approval-request] button[aria-haspopup="dialog"]').length,2);
  await act(async()=>{(document.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).click();});
  assert.ok([...document.querySelectorAll('[data-approval-request]')].every(row=>!(row as HTMLDetailsElement).open));
  requests.push({...requests[0],id:'late'});await act(async()=>root.render(render()));
  assert.equal((document.querySelectorAll('input[type="checkbox"]')[2] as HTMLInputElement).checked,false);
  await act(async()=>approve().click());assert.deepEqual(chosen,[['two']]);
  await act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='approval.rejectAll')!.click());assert.equal(rejected,1);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
it('app intent puts its action before its application name',async t=>{
 const {readFileSync}=await import('node:fs');const strings=JSON.parse(readFileSync(new URL('../src/public/locales/en.json',import.meta.url),'utf8'));
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(strings)));
 const {initI18n}=await import('../src/services/i18n/i18n');await initI18n();
 const {describeSigningIntent}=await import('../src/services/i18n/eventIntent');
 assert.equal(describeSigningIntent('https://primal.net',{kind:30078,tags:[['d','Primal-Web App','get_app_subsettings_home']]}),'https://primal.net wants to get app subsettings home for Primal-Web App.');
 assert.equal(describeSigningIntent('site',{kind:30078,tags:[['d','Example']]}),'site wants to sign app data for Example.');
 assert.equal(describeSigningIntent('site',{kind:55555}),'site wants to sign an event.');
});
it('relay screen includes site and all-sites grants while backend permissions contain only HTTP grants',async t=>{
 const {JSDOM}=await import('jsdom'); const {createRoot}=await import('react-dom/client');
 const {default:Permissions}=await import('../src/screens/Settings/AuthenticationPermissions');
 const {default:Relays}=await import('../src/screens/Settings/RelayAuthentication');
 const {default:browser}=await import('./helpers/browser-mock');
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const grants=[
  {id:'global',accountId:'a',origin:'*',protocol:'nip42',destination:'wss://global.test/'},
  {id:'site',accountId:'a',origin:'https://site.test',protocol:'nip42',destination:'wss://site-relay.test/',decision:'deny'},
  {id:'http',accountId:'a',origin:'https://site.test',protocol:'nip98',destination:'https://api.test',method:'POST'},
  {id:'other',accountId:'b',origin:'*',protocol:'nip42',destination:'wss://other.test/'},
 ];
 t.mock.method(browser.runtime,'sendMessage',async(message:any)=>({result:message.method==='getAllowedDomains' ? ['https://site.test'] : grants}));
 const root=createRoot(document.getElementById('root')!);const accounts=[{id:'a',pubkey:'a'.repeat(64)},{id:'b',pubkey:'b'.repeat(64)}];
 try{
  await act(async()=>root.render(createElement(Relays,{accountId:'a',onBack(){}})));
  assert.ok(document.body.textContent!.includes('global.test'));assert.ok(document.body.textContent!.includes('site-relay.test'));
  assert.ok(!document.body.textContent!.includes('other.test'));assert.ok(!document.body.textContent!.includes('api.test'));
  await act(async()=>root.render(createElement(Relays,{accountId:'b',onBack(){}})));
  assert.ok(document.body.textContent!.includes('other.test'));assert.ok(!document.body.textContent!.includes('global.test'));
  await act(async()=>root.render(createElement(Permissions,{accounts})));
  assert.equal(document.querySelectorAll('tbody tr').length,1);
  assert.ok(!document.body.textContent!.includes('global.test'));assert.ok(!document.body.textContent!.includes('site-relay.test'));
  assert.ok(document.body.textContent!.includes('POST https://api.test'));
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
it('Permissions separates rules from backend and relay authentication',async t=>{
 const {JSDOM}=await import('jsdom');const {createRoot}=await import('react-dom/client');
 const {default:Permissions}=await import('../src/screens/Settings/PermissionsSection');
 const {AccountProvider}=await import('../src/context/AccountContext');const {PermissionsProvider}=await import('../src/context/PermissionsContext');
 const {default:browser,resetMockStorage}=await import('./helpers/browser-mock');
 const {t:label}=await import('../src/services/i18n/i18n');resetMockStorage();
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 t.mock.method(browser.runtime,'sendMessage',async(message:any)=>({result:message.method==='signer_getUseGlobalDefaults' ? true : message.method==='signer_getPermissionsRaw' ? {} : []}));
 await browser.storage.local.set({accounts:[{id:'a',pubkey:'11'.repeat(32),type:'imported'},{id:'b',pubkey:'22'.repeat(32),type:'imported'}],activeAccountId:'a'});
 const root=createRoot(document.getElementById('root')!);
 try{
  await act(async()=>root.render(createElement(AccountProvider,null,createElement(PermissionsProvider,null,createElement(Permissions)))));
  const link=[...document.querySelectorAll('button')].find(button=>button.textContent!.includes(label('auth.manageRelays')))!;
  assert.ok(link);assert.equal(document.querySelector('[aria-haspopup="listbox"]'),null);
  const backendLink=[...document.querySelectorAll('button')].find(element=>element.textContent!.includes(label('auth.manageBackends')))!;
  const rules=[...document.querySelectorAll('button')].find(element=>element.textContent!.includes(label('perms.rulesHint')))!;
  const globals=[...document.querySelectorAll('button')].find(element=>element.textContent!.includes(label('perms.globalRulesHint')))!;
  const backend=document.querySelector(`[aria-label="${label('auth.defaultBackend')}"]`)!;
  const card=link.closest('.shadow-card')!;
  assert.ok(card.classList.contains('shadow-card'));
  assert.ok(card.contains(rules));assert.ok(card.contains(backend));
  assert.equal(card.querySelectorAll('.shadow-card').length,0,'controls share one card without nested cards');
  assert.equal(document.querySelector('input[type="search"]'),null);
  for(const [before,after] of [[globals,rules],[rules,backend],[backend,backendLink],[backendLink,link]]) {
   assert.ok(before);assert.ok(after);assert.ok(before.compareDocumentPosition(after)&dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  }
  assert.equal(document.querySelector('[role="dialog"]'),null);
  await act(async()=>backendLink.click());
  assert.equal(document.querySelector('[role="dialog"]'),null,'backend screen is a full page');
  assert.ok(document.body.textContent!.includes(label('auth.backendAccountOnly')));
  assert.ok(document.body.textContent!.includes(label('auth.backendNoGrants')));
  assert.ok(!document.body.textContent!.includes(label('auth.relayAccountOnly')));
  const backendInfo=document.querySelector<HTMLButtonElement>(`[aria-label="${label('auth.backendInfoTitle')}"]`)!;
  await act(async()=>backendInfo.click());assert.ok(document.querySelector('[role="dialog"]')!.textContent!.includes(label('auth.backendInfo')));
  await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  await act(async()=>document.querySelector<HTMLButtonElement>(`[aria-label="${label('common.back')}"]`)!.click());
  assert.equal(document.querySelector('input[type="search"]'),null);
  const relayLink=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent!.includes(label('auth.manageRelays')))!;
  await act(async()=>relayLink.click());assert.equal(document.querySelector('[role="dialog"]'),null);
  const info=document.querySelector<HTMLButtonElement>(`[aria-label="${label('auth.relayInfoTitle')}"]`)!;
  await act(async()=>info.click());assert.ok(document.querySelector('[role="dialog"]'));
  await act(async()=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(document.querySelector('[role="dialog"]'),null);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
it('intent highlights keep origin/action/app literal and grouped summaries have no numbering or native marker',async t=>{
 const {readFileSync}=await import('node:fs');const strings=JSON.parse(readFileSync(new URL('../src/public/locales/en.json',import.meta.url),'utf8'));
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(strings)));
 const {initI18n}=await import('../src/services/i18n/i18n');await initI18n();
 const {signingIntentParts}=await import('../src/services/i18n/eventIntent');
 const action='get_settings';const app='Literal ]] {origin} <img>';
 const event={kind:30078,tags:[['d',app,action]]};
 const parts=signingIntentParts('https://client.test',event);
 assert.deepEqual(parts.filter(p=>p.accent).map(p=>p.text),['https://client.test','get settings',app]);
 const {default:Detail}=await import('../src/components/EventDetailModal');const {JSDOM}=await import('jsdom');
 const request={id:'a',type:'signEvent',origin:'https://client.test',event};
 const dom=new JSDOM(renderToStaticMarkup(createElement(Detail,{request,requests:[request,{...request,id:'b'}]})));
 const summary=dom.window.document.querySelector('[data-approval-request] > div')!;
 assert.ok(!summary.textContent!.startsWith('1.'));assert.equal(dom.window.document.querySelector('[data-approval-request] > summary'),null);
 assert.equal(summary.querySelectorAll('.text-brand').length,3);
 assert.equal(summary.querySelector('svg.self-end'),null);assert.equal(summary.querySelector('img'),null);
 assert.ok(dom.window.document.querySelector('button[title="Show raw event"]'));
 assert.ok(!dom.window.document.body.textContent!.includes('Advanced'));dom.window.close();
});
it('approval options escape clipped sheets, preserve focus and dismiss without approving',async()=>{
 const {JSDOM}=await import('jsdom');const {createRoot}=await import('react-dom/client');
 const dom=new JSDOM('<div id="root" style="overflow:hidden;height:80px"></div>');
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLElement.prototype.showPopover=function(){this.dataset.topLayer='true';};
 dom.window.HTMLElement.prototype.hidePopover=function(){delete this.dataset.topLayer;};
 const root=createRoot(document.getElementById('root')!);const scopes:string[]=[];
 try{
  await act(async()=>root.render(createElement(AuthenticationActions,{authentication:{...authentication,protocol:'nip42'},onApprove:scope=>scopes.push(scope),onDeny(){},onAlwaysDeny(){}})));
  const trigger=document.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  await act(async()=>trigger.click());
  const menu=document.querySelector<HTMLElement>('[role="menu"]')!;
  assert.equal(menu.getAttribute('popover'),'manual');assert.equal(menu.dataset.topLayer,'true');
  assert.equal(menu.querySelectorAll('[role="menuitem"]').length,2);
  assert.equal(document.activeElement,menu.querySelector('[role="menuitem"]'));
  await act(async()=>document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
  assert.equal(document.querySelector('[role="menu"]'),null);assert.equal(document.activeElement,trigger);assert.deepEqual(scopes,[]);
  await act(async()=>trigger.click());
  await act(async()=>document.dispatchEvent(new dom.window.Event('scroll')));
  assert.equal(document.querySelector('[role="menu"]'),null);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
it('authentication permissions refresh after background saves and revocations without remounting',async t=>{
 const {JSDOM}=await import('jsdom');const {createRoot}=await import('react-dom/client');
 const {default:Permissions}=await import('../src/screens/Settings/AuthenticationPermissions');
 const {default:browser}=await import('./helpers/browser-mock');
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 await browser.storage.local.set({authenticationGrants:[]});
 t.mock.method(browser.runtime,'sendMessage',async()=>({result:(await browser.storage.local.get('authenticationGrants')).authenticationGrants}));
 const root=createRoot(document.getElementById('root')!);
 const grant={id:'obelisk',accountId:'a',origin:'https://obelisk.ar',protocol:'nip98',destination:'https://api.obelisk.ar',resource:'https://api.obelisk.ar/login',method:'POST',version:2,decision:'allow'};
 try{
  await act(async()=>root.render(createElement(Permissions,{accounts:[{id:'a',pubkey:'a'.repeat(64)}],activeId:'a'})));
  assert.equal(document.querySelectorAll('tbody tr').length,0);
  await act(async()=>{await browser.storage.local.set({authenticationGrants:[grant,{...grant,id:'other',accountId:'b',origin:'https://other.test'}]});});
  assert.equal(document.querySelectorAll('tbody tr').length,1);assert.ok(document.body.textContent!.includes('https://obelisk.ar'));assert.ok(document.body.textContent!.includes('POST https://api.obelisk.ar/login'));
  await act(async()=>{await browser.storage.local.set({authenticationGrants:[]});});
  assert.equal(document.querySelectorAll('tbody tr').length,0);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
it('default backend toggle is off initially, saves for the active account and explains its scope',async t=>{
 const {JSDOM}=await import('jsdom');const {createRoot}=await import('react-dom/client');
 const {default:Permissions}=await import('../src/screens/Settings/DefaultBackendAuth');
 const {default:browser}=await import('./helpers/browser-mock');const {t:label}=await import('../src/services/i18n/i18n');
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 let enabled=false;const saves:unknown[]=[];
 t.mock.method(browser.runtime,'sendMessage',async(message:any)=>{
  if(message.method==='signer_setDefaultBackendAuth'){saves.push(message.params);enabled=message.params.enabled;return {result:{ok:true}};}
  return {result:message.method==='signer_getDefaultBackendAuth' ? enabled : []};
 });
 const root=createRoot(document.getElementById('root')!);
 try{
  await act(async()=>root.render(createElement(Permissions,{accountId:'a'})));
  const toggle=document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;assert.equal(toggle.checked,false);
  await act(async()=>toggle.click());assert.deepEqual(saves,[{accountId:'a',enabled:true}]);assert.equal(toggle.checked,true);
  const info=document.querySelector<HTMLButtonElement>(`[aria-label="${label('auth.defaultBackendInfo')}"]`)!;
  await act(async()=>info.click());assert.ok(document.querySelector('[role="dialog"]')!.textContent!.includes(label('auth.defaultBackendLimits')));
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
it('kind 9007 has a create-group intent and a custom preview with raw event access',async()=>{
 const {default:Detail}=await import('../src/components/EventDetailModal');
 const {describeSigningIntent}=await import('../src/services/i18n/eventIntent');
 const {t:label}=await import('../src/services/i18n/i18n');
 const event={kind:9007,content:'A new community',tags:[['h','group-id'],['name','<img onerror=evil()>'],['about','Group description']]};
 const intent=describeSigningIntent('https://obelisk.ar',event);assert.ok(intent.includes('<img onerror=evil()>'));
 const html=renderToStaticMarkup(createElement(Detail,{request:{type:'signEvent',origin:'https://obelisk.ar',event,permKey:'signEvent:9007'},onApprove(){},onDeny(){}}));
 assert.ok(html.includes('group-id'));assert.ok(html.includes('Group description'));assert.ok(html.includes('A new community'));
 assert.ok(html.includes(label('event.showRaw')));assert.ok(!html.includes(label('event.unknownKind')));assert.ok(!html.includes('<img onerror=evil()>'));
});
it('the current denied site opens its duration editor without listing other sites',async t=>{
 const {JSDOM}=await import('jsdom');const {createRoot}=await import('react-dom/client');
 const {default:Permissions}=await import('../src/screens/Settings/PermissionsSection');
 const {AccountProvider}=await import('../src/context/AccountContext');const {PermissionsProvider}=await import('../src/context/PermissionsContext');
 const {default:browser,resetMockStorage}=await import('./helpers/browser-mock');
 const {t:label}=await import('../src/services/i18n/i18n');resetMockStorage();
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLElement.prototype.showPopover=function(){};
 dom.window.HTMLElement.prototype.hidePopover=function(){};
 t.mock.method(browser.tabs,'query',async()=>[{id:1,url:'https://declined.test/chat'}]);
 let until:number|'never'=Date.now()+86400000;const updates:unknown[]=[];
 t.mock.method(browser.runtime,'sendMessage',async(message:any)=>{
  if(message.method==='getDismissedDomains')return {result:[{domain:'https://declined.test',until}]};
  if(message.method==='updateDismissedDomain'){updates.push(message.params);until='never';return {result:true};}
  if(message.method==='signer_getPermissionsRaw')return {result:{'https://allowed.test':{_default:{'signEvent:1':'allow'}},'https://declined.test':{_default:{'signEvent:1':'allow'}}}};
  return {result:message.method==='signer_getUseGlobalDefaults' ? true : []};
 });
 await browser.storage.local.set({accounts:[{id:'a',pubkey:'11'.repeat(32),type:'imported'}],activeAccountId:'a'});
 const root=createRoot(document.getElementById('root')!);
 try{
  await act(async()=>root.render(createElement(AccountProvider,null,createElement(PermissionsProvider,null,createElement(Permissions)))));
  await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent!.includes(label('perms.rulesHint')))!.click());
  assert.equal(document.querySelector('input[type="search"]'),null);
  assert.ok(document.body.textContent!.includes('https://declined.test'));
  assert.ok(!document.body.textContent!.includes('https://allowed.test'));
  assert.ok(document.body.textContent!.includes(label('perm.declined')));
  assert.equal(document.querySelector('[role="dialog"]'),null);
  const dropdown=document.querySelector<HTMLButtonElement>(`[aria-label="${label('perm.changeDuration')}"]`)!;
  await act(async()=>dropdown.click());
  const forever=[...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(option=>option.textContent===label('perm.duration.forever'))!;
  await act(async()=>forever.click());
  assert.deepEqual(updates,[{domain:'https://declined.test',duration:'never'}]);
  assert.ok(document.body.textContent!.includes(label('perm.declinedNever')));
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
it('relay editor selects connected apps, saves explicit scopes, and uses back navigation',async t=>{
 const {JSDOM}=await import('jsdom');const {createRoot}=await import('react-dom/client');
 const {default:Relays}=await import('../src/screens/Settings/RelayAuthentication');
 const {default:browser}=await import('./helpers/browser-mock');const {t:label}=await import('../src/services/i18n/i18n');
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const grants=[{id:'one',accountId:'a',origin:'https://one.test',protocol:'nip42',destination:'wss://relay.test/',decision:'allow'}];
 const saves:any[]=[];let backs=0;
 t.mock.method(browser.runtime,'sendMessage',async(message:any)=>{
  if(message.method==='getAllowedDomains')return {result:['https://one.test','https://two.test']};
  if(message.method==='signer_getAuthenticationGrants')return {result:grants};
  if(message.method==='signer_setRelayAuthenticationSites'){saves.push(message.params);return {result:{ok:true}};}
  return {result:null};
 });
 const root=createRoot(document.getElementById('root')!);
 try{
  await act(async()=>root.render(createElement(Relays,{accountId:'a',onBack(){backs++;}})));
  assert.ok(document.body.textContent!.includes(label('auth.oneSiteApproved')));
  const relay=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent!.includes('relay.test'))!;
  await act(async()=>relay.click());
  const one=document.querySelector<HTMLInputElement>('[aria-label="https://one.test"]')!;
  const two=document.querySelector<HTMLInputElement>('[aria-label="https://two.test"]')!;
  assert.equal(one.checked,true);assert.equal(two.checked,false);
  await act(async()=>{one.click();two.click();});
  const save=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===label('common.save'))!;
  await act(async()=>save.click());
  assert.equal(saves.length,1);assert.deepEqual(saves[0].origins,['https://two.test']);assert.equal(saves[0].allSites,false);
  assert.equal(saves[0].accountId,'a');assert.equal(saves[0].destination,'wss://relay.test/');assert.equal(typeof saves[0].revision,'string');
  assert.equal(document.querySelector('[aria-label="https://two.test"]'),null,'save returns to relay list');
  await act(async()=>document.querySelector<HTMLButtonElement>(`[aria-label="${label('common.back')}"]`)!.click());
  assert.equal(backs,1);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
it('deselecting an all-sites relay keeps other allowed sites selected and permits revoking all',async t=>{
 const {JSDOM}=await import('jsdom');const {createRoot}=await import('react-dom/client');
 const {default:Relays}=await import('../src/screens/Settings/RelayAuthentication');
 const {default:browser}=await import('./helpers/browser-mock');const {t:label}=await import('../src/services/i18n/i18n');
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const grants=[
  {id:'all',accountId:'a',origin:'*',protocol:'nip42',destination:'wss://relay.test/',decision:'allow'},
  {id:'deny',accountId:'a',origin:'https://blocked.test',protocol:'nip42',destination:'wss://relay.test/',decision:'deny'},
 ];
 const saves:any[]=[];let fail=true;
 t.mock.method(browser.runtime,'sendMessage',async(message:any)=>{
  if(message.method==='getAllowedDomains')return {result:['https://one.test','https://two.test','https://blocked.test']};
  if(message.method==='signer_getAuthenticationGrants')return {result:grants};
  if(message.method==='signer_setRelayAuthenticationSites'){saves.push(message.params);return fail?{error:'Relay permissions changed; reopen the editor'}:{result:{ok:true}};}
  return {result:null};
 });
 const root=createRoot(document.getElementById('root')!);
 try{
  await act(async()=>root.render(createElement(Relays,{accountId:'a',onBack(){}})));
  await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent!.includes('relay.test'))!.click());
  const one=document.querySelector<HTMLInputElement>('[aria-label="https://one.test"]')!;
  const two=document.querySelector<HTMLInputElement>('[aria-label="https://two.test"]')!;
  const blocked=document.querySelector<HTMLInputElement>('[aria-label="https://blocked.test"]')!;
  const all=document.querySelector<HTMLInputElement>(`[aria-label="${label('auth.allConnectedSites')}"]`)!;
  assert.equal(all.checked,true);assert.equal(one.disabled,false);assert.equal(two.checked,true);assert.equal(blocked.checked,false);
  await act(async()=>one.click());
  assert.equal(all.checked,false);assert.equal(one.checked,false);assert.equal(two.checked,true);assert.equal(blocked.checked,false);
  const save=[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===label('common.save'))!;
  await act(async()=>save.click());
  assert.deepEqual(saves[0].origins,['https://two.test']);assert.equal(saves[0].allSites,false);
  assert.ok(document.body.textContent!.includes(label('auth.relaySaveStale')));
  assert.ok(!document.body.textContent!.includes(label('approval.actionFailed')));
  await act(async()=>two.click());fail=false;
  await act(async()=>save.click());
  assert.deepEqual(saves[1].origins,[]);assert.equal(saves[1].allSites,false);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
it('Rules distinguishes inherited rules and overrides, and global reset requires confirmation',async t=>{
 const {JSDOM}=await import('jsdom');const {createRoot}=await import('react-dom/client');
 const {default:Permissions}=await import('../src/screens/Settings/PermissionsSection');
 const {AccountProvider}=await import('../src/context/AccountContext');const {PermissionsProvider}=await import('../src/context/PermissionsContext');
 const {default:browser,resetMockStorage}=await import('./helpers/browser-mock');const {t:label}=await import('../src/services/i18n/i18n');
 resetMockStorage();
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLElement.prototype.showPopover=function(){};dom.window.HTMLElement.prototype.hidePopover=function(){};
 t.mock.method(browser.tabs,'query',async()=>[{id:1,url:'https://site.test/chat'}]);
 let raw:any={'_global':{_default:{'signEvent:7':'deny'}},'https://site.test':{_default:{readMessages:'allow',getPublicKey:'allow'},a:{getPublicKey:'deny'}}};
 let resets=0;let siteResets=0;const saves:any[]=[];
 t.mock.method(browser.runtime,'sendMessage',async(message:any)=>{
  if(message.method==='signer_getPermissionsRaw')return {result:raw};
  if(message.method==='signer_getUseGlobalDefaults')return {result:false};
  if(message.method==='signer_savePermission'){
   saves.push(message.params);raw[message.params.domain][message.params.accountId || '_default'][message.params.methodName]=message.params.decision;return {result:{ok:true}};
  }
  if(message.method==='signer_clearRuleBucket'){siteResets++;assert.deepEqual(message.params,{domain:'https://site.test',accountId:'a'});raw['https://site.test'].a={};return {result:{ok:true}};}
  if(message.method==='signer_inheritRule'){delete raw['https://site.test'].a[message.params.key];return {result:{ok:true}};}
  if(message.method==='signer_resetAccountRules'){resets++;raw={'_global':raw._global,'https://site.test':{_default:raw['https://site.test']._default}};return {result:{ok:true}};}
  return {result:[]};
 });
 await browser.storage.local.set({accounts:[{id:'a',pubkey:'11'.repeat(32),type:'nsec'}],activeAccountId:'a'});
 const root=createRoot(document.getElementById('root')!);
 const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent===text || button.textContent!.includes(text))!;
 const back=()=>document.querySelector<HTMLButtonElement>(`[aria-label="${label('common.back')}"]`)!;
 try{
  await act(async()=>root.render(createElement(AccountProvider,null,createElement(PermissionsProvider,null,createElement(Permissions)))));
  assert.equal(document.querySelector('input[type="search"]'),null);
  assert.ok(!document.body.textContent!.includes(label('perms.allAccounts')));
  await act(async()=>button(label('perms.rulesHint')).click());
  assert.equal(document.querySelector('input[type="search"]'),null);
  assert.ok(document.body.textContent!.includes('https://site.test'));
  assert.ok(document.body.textContent!.includes(label('perms.inheritedRule')));
  assert.ok(document.body.textContent!.includes(label('perms.accountRule')));
  const inherited=button(label('perms.allow'));assert.ok(inherited.classList.contains('text-secondary'));
  await act(async()=>inherited.click());
  await act(async()=>document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1].click());
  assert.equal(saves[0].accountId,'a');assert.equal(saves[0].methodName,'readMessages');
  assert.equal(raw['https://site.test']._default.readMessages,'allow');
  await act(async()=>button(label('perms.resetSiteRules')).click());
  assert.equal(siteResets,0);assert.ok(document.querySelector('[role="dialog"]'));
  assert.ok(document.querySelector('[role="dialog"]')!.textContent!.includes('https://site.test'));
  await act(async()=>button(label('common.cancel')).click());assert.equal(siteResets,0);
  assert.ok(document.body.textContent!.includes('https://site.test'));
  await act(async()=>button(label('perms.resetSiteRules')).click());
  await act(async()=>button(label('common.confirm')).click());
  assert.equal(siteResets,1);assert.equal(document.querySelector('[role="dialog"]'),null);
  assert.ok(document.body.textContent!.includes('https://site.test'));
  assert.ok(button(label('perms.resetSiteRules')),'reset keeps the site editor open');
  assert.equal(document.querySelector('input[type="search"]'),null);
  await act(async()=>back().click());
  await act(async()=>button(label('perms.globalRulesHint')).click());
  assert.equal(document.querySelector('input[type="search"]'),null);
  assert.ok(!document.body.textContent!.includes('https://site.test'));
  assert.ok(document.body.textContent!.includes(label('perms.globalRulesInfo')));
  await act(async()=>button(label('perms.deny')).click());
  await act(async()=>document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[0].click());
  assert.equal(saves[1].domain,'_global');assert.ok(!saves[1].accountId);
  assert.equal(raw._global._default['signEvent:7'],'allow');
  await act(async()=>back().click());
  assert.ok(button(label('perms.rulesHint')));
  assert.equal(document.querySelector('input[type="search"]'),null);
  await act(async()=>button(label('perms.globalRulesHint')).click());
  await act(async()=>button(label('perms.resetAccountRules')).click());
  assert.equal(resets,0);assert.ok(document.querySelector('[role="dialog"]'));
  await act(async()=>button(label('common.cancel')).click());assert.equal(resets,0);
  await act(async()=>button(label('perms.resetAccountRules')).click());
  await act(async()=>button(label('common.confirm')).click());assert.equal(resets,1);
  assert.deepEqual(Object.keys(raw['https://site.test']),['_default']);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});

it('note approval shows full escaped content, grouped notes and kind-specific visual previews',async()=>{
 const {default:Detail}=await import('../src/components/EventDetailModal');
 const {t:label}=await import('../src/services/i18n/i18n');
 const note={id:'note',type:'signEvent',origin:'https://site.test',event:{kind:1,content:'First line\n<img src=x onerror=evil()>\n'+'long note '.repeat(250),tags:[]}};
 const html=renderToStaticMarkup(createElement(Detail,{request:note,onApprove(){}}));
 assert.ok(html.includes('First line'));assert.ok(html.includes('long note '.repeat(250)));
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x'));
 assert.ok(html.includes(label('event.showRaw')));
 const reaction={...note,id:'reaction',event:{kind:7,content:'🔥',tags:[['e','target']]}};
 const grouped=renderToStaticMarkup(createElement(Detail,{request:note,requests:[note,reaction],onApproveSelected(){}}));
 assert.ok(grouped.includes('First line'));assert.ok(grouped.includes('🔥'));assert.ok(grouped.includes('text-display'));
 const profile={...note,event:{kind:0,content:JSON.stringify({name:'Alice',about:'Public profile biography'}),tags:[]}};
 assert.ok(renderToStaticMarkup(createElement(Detail,{request:profile})).includes('Alice'));
 const repost={...note,event:{kind:6,content:JSON.stringify({kind:1,content:'Embedded repost text'}),tags:[]}};
 assert.ok(renderToStaticMarkup(createElement(Detail,{request:repost})).includes('Embedded repost text'));
});


it('Site rules has a current-tab-only empty state and never lists saved sites',async t=>{
 const {JSDOM}=await import('jsdom');const {createRoot}=await import('react-dom/client');
 const {default:Permissions}=await import('../src/screens/Settings/PermissionsSection');
 const {AccountProvider}=await import('../src/context/AccountContext');const {PermissionsProvider}=await import('../src/context/PermissionsContext');
 const {default:browser,resetMockStorage}=await import('./helpers/browser-mock');const {t:label}=await import('../src/services/i18n/i18n');
 resetMockStorage();
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 let tabs:any[]=[];
 t.mock.method(browser.tabs,'query',async()=>tabs);
 t.mock.method(browser.runtime,'sendMessage',async(message:any)=>({result:message.method==='signer_getPermissionsRaw'?{'https://old.test':{a:{readMessages:'allow'}}}:message.method==='signer_getUseGlobalDefaults'?false:[]}));
 await browser.storage.local.set({accounts:[{id:'a',pubkey:'11'.repeat(32),type:'nsec'}],activeAccountId:'a'});
 const root=createRoot(document.getElementById('root')!);
 try {
  for(const [key,url] of ['','chrome://extensions','file:///private/document','https://current.test:8443/path'].entries()) {
   tabs=url?[{id:1,url}]:[];
   await act(async()=>root.render(createElement(AccountProvider,null,createElement(PermissionsProvider,null,createElement(Permissions,{key})))));
   await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent!.includes(label('perms.rulesHint')))!.click());
   assert.equal(document.querySelector('input[type="search"]'),null);
   assert.ok(!document.body.textContent!.includes('https://old.test'));
   if(url.startsWith('https:')) assert.ok(document.body.textContent!.includes('https://current.test:8443'));
   else {assert.ok(document.body.textContent!.includes(label('perms.visitSite')));assert.ok(!document.body.textContent!.includes(label('perms.addRule')));}
  }
 } finally {await act(async()=>root.unmount());dom.window.close();}
});
