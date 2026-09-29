import {it} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {JSDOM} from 'jsdom';
import {createRoot} from 'react-dom/client';
import MessageRequestDetail from '../src/components/EventDetailModal/MessageRequestDetail';
import Detail from '../src/components/EventDetailModal';
import browser,{resetMockStorage} from './helpers/browser-mock.ts';

it('message review uses cached profile, reveals only on demand, and clears after account change',async t=>{
 resetMockStorage();const peer='22'.repeat(32);
 await browser.storage.local.set({[`profile_${peer}`]:{metadata:{name:'Cached Alice',about:'Not needed here',picture:'https://sender-controlled.test/avatar.png'}}});
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(document.getElementById('root')!);const calls:any[]=[];
 t.mock.method(browser.runtime,'sendMessage',async(message:any)=>{
  calls.push(message);return {result:{request:{method:'nip44Decrypt',origin:'https://client.test',params:{pubkey:peer,ciphertext:'full ciphertext'}},...(message.params.reveal?{plaintext:'secret text'}:{})}};
 });
 try{
  await act(async()=>root.render(createElement(MessageRequestDetail,{request:{id:'pending',type:'nip44Decrypt',theirPubkey:peer}})));
  assert.ok(document.body.textContent!.includes('Cached Alice'));assert.ok(document.body.textContent!.includes('messageReview.sender'));
  assert.ok(!document.body.textContent!.includes('Not needed here'));assert.equal(document.querySelector('img'),null);assert.equal(calls.length,0);
  assert.equal(document.querySelector(`[title="${peer}"]`),null);
  assert.ok(document.body.textContent!.includes('approval.detail.content'));
  const button=(key:string)=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===key)!;
  await act(async()=>button('key.clickToReveal').click());assert.ok(document.body.textContent!.includes('secret text'));
  assert.deepEqual(calls.map(c=>[c.method,c.params]),[['signer_previewRequest',{id:'pending',reveal:true}]]);
  await act(async()=>button('key.clickToBlur').click());assert.ok(!document.body.textContent!.includes('secret text'));
  const advanced=document.querySelector('details')!;
  await act(async()=>{advanced.open=true;advanced.dispatchEvent(new dom.window.Event('toggle'));});
  assert.ok(document.body.textContent!.includes('full ciphertext'));assert.equal(calls.at(-1).params.reveal,false);
  await act(async()=>browser.storage.local.set({activeAccountId:'another'}));
  assert.ok(!document.body.textContent!.includes('full ciphertext'));assert.ok(!document.body.textContent!.includes('secret text'));
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
it('message detail removes the duplicate event card heading and shows recipient for outgoing requests',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');
 const html=renderToStaticMarkup(createElement(Detail,{request:{id:'send',type:'nip44Encrypt',origin:'https://client.test',theirPubkey:'22'.repeat(32)},onApprove(){},onDeny(){}}));
 assert.ok(html.includes('event.recipient'));assert.ok(html.includes('common.advanced'));
 assert.ok(html.includes('border-t border-card-border pt-6'));assert.ok(html.includes('approval.detail.content'));
 assert.ok(!html.includes('event.encryptedDesc'));assert.ok(!html.includes('<h3'));
});
it('late preview replies cannot reveal a message after the account changed',async t=>{
 resetMockStorage();const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(document.getElementById('root')!);let finish!:(v:any)=>void;
 t.mock.method(browser.runtime,'sendMessage',()=>new Promise(resolve=>{finish=resolve;}));
 try{
  await act(async()=>root.render(createElement(MessageRequestDetail,{request:{id:'pending',type:'nip44Decrypt'}})));
  await act(async()=>{(document.querySelector('button') as HTMLButtonElement).click();});
  await act(async()=>browser.storage.local.set({activeAccountId:'another'}));
  await act(async()=>finish({result:{request:{method:'nip44Decrypt',origin:'site',params:{}},plaintext:'late secret'}}));
  assert.ok(!document.body.textContent!.includes('late secret'));
 }finally{await act(async()=>root.unmount());dom.window.close();}
});

it('preview failures show the real cause exactly once, including after Advanced opens',async t=>{
 resetMockStorage();const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(document.getElementById('root')!);
 const failure='Request preview is no longer available';
 t.mock.method(browser.runtime,'sendMessage',async()=>({error:failure}));
 try{
  await act(async()=>root.render(createElement(MessageRequestDetail,{request:{id:'pending',type:'nip44Decrypt'}})));
  await act(async()=>(document.querySelector('button') as HTMLButtonElement).click());
  assert.equal(document.body.textContent!.split(failure).length-1,1);
  const advanced=document.querySelector('details')!;
  await act(async()=>{advanced.open=true;advanced.dispatchEvent(new dom.window.Event('toggle'));});
  assert.equal(document.body.textContent!.split(failure).length-1,1);
  assert.ok(!document.body.textContent!.includes('messageReview.unavailable'));
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
it('revealing a wrapped message refreshes the cached sender profile',async t=>{
 resetMockStorage();const peer='22'.repeat(32);const wrapper='33'.repeat(32);
 await browser.storage.local.set({[`profile_${peer}`]:{metadata:{name:'Real sender'}}});
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(document.getElementById('root')!);
 t.mock.method(browser.runtime,'sendMessage',async()=>({result:{request:{method:'nip44Decrypt',origin:'site',params:{}},plaintext:'hello',senderPubkey:peer}}));
 try{
  await act(async()=>root.render(createElement(MessageRequestDetail,{request:{id:'pending',type:'nip44Decrypt',theirPubkey:wrapper}})));
  assert.ok(!document.body.textContent!.includes('Real sender'));
  await act(async()=>(document.querySelector('button') as HTMLButtonElement).click());
  assert.ok(document.body.textContent!.includes('Real sender'));assert.ok(document.body.textContent!.includes('hello'));
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
it('grouped messages use numbered headings instead of repeating the permission label',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');
 const request={id:'one',type:'nip44Decrypt',origin:'site',theirPubkey:'22'.repeat(32)};
 const html=renderToStaticMarkup(createElement(Detail,{request,requests:[request,{...request,id:'two'}],onApprove(){},onDeny(){}}));
 assert.equal(html.split('messageReview.messageNumber').length-1,2);
});
it('missing wrapped sender is looked up in the profile directory only after Reveal',async t=>{
 resetMockStorage();const peer='22'.repeat(32),wrapper='33'.repeat(32);const calls:any[]=[];
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(document.getElementById('root')!);
 t.mock.method(browser.runtime,'sendMessage',async(message:any)=>{
  calls.push(message);
  return {result:message.method==='getProfileMetadata'?{name:'Directory Alice'}:{request:{method:'nip44Decrypt',origin:'site',params:{}},plaintext:'hello',senderPubkey:peer}};
 });
 try{
  await act(async()=>root.render(createElement(MessageRequestDetail,{request:{id:'pending',type:'nip44Decrypt',theirPubkey:wrapper}})));
  assert.equal(calls.length,0);assert.ok(!document.body.textContent!.includes('messageReview.noCachedProfile'));
  await act(async()=>(document.querySelector('button') as HTMLButtonElement).click());
  assert.ok(document.body.textContent!.includes('Directory Alice'));
  assert.deepEqual(calls.filter(c=>c.method==='getProfileMetadata').map(c=>c.params),[{pubkey:peer,directory:true}]);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
it('profile lookup failure leaves the key and message usable',async t=>{
 resetMockStorage();const peer='22'.repeat(32);
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(document.getElementById('root')!);
 t.mock.method(browser.runtime,'sendMessage',async(message:any)=> message.method==='getProfileMetadata'?{error:'relay unavailable'}:{result:{request:{method:'nip04Decrypt',origin:'site',params:{}},plaintext:'hello'}});
 try{
  await act(async()=>root.render(createElement(MessageRequestDetail,{request:{id:'pending',type:'nip04Decrypt',theirPubkey:peer}})));
  await act(async()=>(document.querySelector('button') as HTMLButtonElement).click());
  assert.ok(document.body.textContent!.includes('hello'));assert.ok(document.body.textContent!.includes('22222222'));assert.ok(!document.body.textContent!.includes('common.loading'));
 }finally{await act(async()=>root.unmount());dom.window.close();}
});

it('message content starts concealed and is removed again after 30 seconds',async t=>{
 resetMockStorage();const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(document.getElementById('root')!);
 t.mock.method(browser.runtime,'sendMessage',async()=>({result:{request:{method:'nip44Decrypt',origin:'site',params:{}},plaintext:'timed secret',decryptedEvent:{content:'timed secret'}}}));
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});
 try{
  await act(async()=>root.render(createElement(MessageRequestDetail,{request:{id:'pending',type:'nip44Decrypt'}})));
  assert.ok(document.querySelector('[aria-hidden="true"]'));
  assert.ok(!document.body.textContent!.includes('timed secret'));
  assert.ok(document.querySelector('button')!.textContent!.includes('key.autoHideHint'));
  await act(async()=>(document.querySelector('button') as HTMLButtonElement).click());
  assert.ok(document.body.textContent!.includes('timed secret'));
  assert.equal(document.querySelector('[data-reveal-countdown] circle')!.getAttribute('stroke-dasharray'),'30 30');
  assert.ok(!document.querySelector('button')!.textContent!.includes('key.autoHideHint'));
  assert.ok(document.querySelector('[data-reveal-countdown]')!.classList.contains('right-0'));
  await act(async()=>t.mock.timers.tick(1000));
  assert.equal(document.querySelector('[data-reveal-countdown] circle')!.getAttribute('stroke-dasharray'),'29 30');
  await act(async()=>t.mock.timers.tick(29000));
  assert.equal(document.querySelector('[data-reveal-countdown]'),null);
  assert.ok(!document.body.textContent!.includes('timed secret'));
  assert.ok(document.querySelector('button')!.textContent!.includes('key.autoHideHint'));
  assert.equal(document.querySelector('button')!.getAttribute('aria-pressed'),'false');
 }finally{await act(async()=>root.unmount());dom.window.close();t.mock.timers.reset();}
});

it('outgoing Advanced plaintext follows manual hide and auto-hide too',async t=>{
 resetMockStorage();const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(document.getElementById('root')!);
 t.mock.method(browser.runtime,'sendMessage',async()=>({result:{request:{method:'nip44Encrypt',origin:'site',params:{plaintext:'outgoing secret'}},plaintext:'outgoing secret'}}));
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});
 try{
  await act(async()=>root.render(createElement(MessageRequestDetail,{request:{id:'pending',type:'nip44Encrypt'}})));
  const advanced=document.querySelector('details')!;
  await act(async()=>{advanced.open=true;advanced.dispatchEvent(new dom.window.Event('toggle'));});
  assert.ok(!document.body.textContent!.includes('outgoing secret'));
  const button=()=>document.querySelector('button') as HTMLButtonElement;
  await act(async()=>button().click());assert.ok(document.body.textContent!.includes('outgoing secret'));
  await act(async()=>button().click());assert.ok(!document.body.textContent!.includes('outgoing secret'));
  await act(async()=>button().click());assert.ok(document.body.textContent!.includes('outgoing secret'));
  await act(async()=>t.mock.timers.tick(30000));assert.ok(!document.body.textContent!.includes('outgoing secret'));
 }finally{await act(async()=>root.unmount());dom.window.close();t.mock.timers.reset();}
});
