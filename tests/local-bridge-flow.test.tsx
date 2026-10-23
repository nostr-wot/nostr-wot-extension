import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Input from '../src/components/Input';
import IconButton from '../src/components/IconButton';
import LocalBridgeApp from '../src/entrypoints/local-bridge/LocalBridgeApp';
import { LocalBridgeClient } from '../src/services/signing/localBridge/client';
import browser from './helpers/browser-mock';

test('input actions remain labeled and reserve space beside password visibility', () => {
 const html=renderToStaticMarkup(React.createElement(Input,{type:'password',showToggle:true,label:'Pairing code',actions:[<IconButton aria-label="Camera" key="camera">C</IconButton>,<IconButton aria-label="Sound" key="sound">S</IconButton>]}));
 const dom=new JSDOM(html);const input=dom.window.document.querySelector('input')!;
 assert.equal(input.style.paddingRight,'132px');assert.equal(dom.window.document.querySelectorAll('button').length,3);
 assert.ok(dom.window.document.querySelector('[aria-label="Camera"]'));assert.ok(dom.window.document.querySelector('[aria-label="Sound"]'));dom.window.close();
});
for (const mode of ['wifi','ble'] as const) test(`${mode} setup uses the appropriate direct connection flow`, async t => {
 const dom=new JSDOM('<div id="root"></div>',{url:'https://extension.test'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{bluetooth:{},userAgent:"test"}});
 t.mock.method(browser.runtime,'sendMessage',async()=>({result:{selected:false}}));
 let attempts=0;t.mock.method(LocalBridgeClient,'connect',async()=>{attempts++;throw new Error('test connection');});
 t.mock.method(LocalBridgeClient,'connectBluetooth',async()=>{attempts++;throw new Error('test connection');});
 const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root')!);
 try {
  await act(async()=>root.render(createElement(LocalBridgeApp)));
  const choose=[...document.querySelectorAll('button')].find(b=>b.textContent?.includes(`localBridge.${mode}`))!;
  await act(async()=>choose.click());
  if(mode==='ble') {
   assert.equal(document.querySelectorAll('input').length,0);
   const phone=[...document.querySelectorAll('button')].find(b=>b.textContent==='localBridge.choosePhone')!;
   assert.ok(phone); await act(async()=>phone.click()); assert.equal(attempts,1); return;
  }
  assert.equal(document.querySelectorAll('input').length,1);
  assert.ok(document.querySelector('[aria-label="localBridge.scan"]'));
  const sound = document.querySelector<HTMLButtonElement>('[aria-label="localBridge.sound"]')!;
  assert.ok(sound); assert.equal(sound.disabled, false);
  assert.equal(document.getElementById('sound-unavailable'), null);
  const back=[...document.querySelectorAll('button')].find(b=>b.textContent==='common.back')!;
  assert.ok(back.closest('[data-testid="bridge-card"]'));assert.match(back.className,/text-secondary/);assert.match(back.className,/bg-hover/);
  const uri=`nwlan://${'11'.repeat(32)}?v=2&psk=${Buffer.alloc(32,2).toString('base64url')}&addr=192.168.1.2:54211`;
  await act(async()=>{const paste=new dom.window.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(paste,'clipboardData',{value:{getData:()=>uri}});document.querySelector('input')!.dispatchEvent(paste);});
  assert.equal(attempts,1);
  assert.ok(![...document.querySelectorAll('button')].some(b=>b.textContent==='localBridge.connect'));
 } finally {await act(async()=>root.unmount());dom.window.close();if(previous)Object.defineProperty(globalThis,'navigator',previous);else Reflect.deleteProperty(globalThis,'navigator');}
});

test('connected bridge explains page lifetime and uses one disconnect action to stop the signer', async t => {
 const dom=new JSDOM('<div id="root"></div>',{url:'https://extension.test'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{bluetooth:{},userAgent:'test'}});
 let disabled=0,closed=0;
 t.mock.method(browser.runtime,'sendMessage',async(message:any)=>{if(message.method==='localBridgeDisable')disabled++;return {result:{selected:false}};});
 const pubkey='ab'.repeat(32);
 t.mock.method(LocalBridgeClient,'connectBluetooth',async()=>({request:async()=>pubkey,close:()=>{closed++;},onClose:()=>()=>{}} as unknown as LocalBridgeClient));
 const listeners=new Set<(value:unknown)=>void>();
 const previousConnect=(browser.runtime as any).connect;
 (browser.runtime as any).connect=()=>({postMessage:(message:any)=>{if(message.type==='ready')queueMicrotask(()=>{for(const fn of listeners)fn({type:'ready',pubkey});});},disconnect:()=>{},onMessage:{addListener:(fn:any)=>listeners.add(fn),removeListener:(fn:any)=>listeners.delete(fn)},onDisconnect:{addListener:()=>{},removeListener:()=>{}}} as any);
 const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root')!);
 const button=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)!;
 try {
  await act(async()=>root.render(createElement(LocalBridgeApp)));
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent?.includes('localBridge.ble'))!.click());
  await act(async()=>button('localBridge.choosePhone').click());
  assert.ok(document.querySelector('strong')?.textContent?.includes('localBridge.keepOpenTitle'));
  assert.ok(document.body.textContent?.includes('localBridge.keepOpenHint'));
  assert.match(button('localBridge.disconnect').className,/text-error/);
  assert.match(button('localBridge.disconnect').className,/bg-\[rgba\(220,38,38,0.1\)\]/);
  assert.ok(document.body.textContent?.includes('localBridge.disconnectHint'));
  assert.equal(button('localBridge.disable'),undefined);
  assert.equal([...document.querySelectorAll('button')].filter(b=>b.textContent==='localBridge.disconnect').length,1);
  await act(async()=>button('localBridge.disconnect').click());
  assert.equal(closed,1);assert.equal(disabled,1);
  assert.equal(button('localBridge.disconnect'),undefined);
  assert.equal(button('localBridge.disable'),undefined);
 } finally {(browser.runtime as any).connect=previousConnect;await act(async()=>root.unmount());dom.window.close();if(previous)Object.defineProperty(globalThis,'navigator',previous);else Reflect.deleteProperty(globalThis,'navigator');}
});
