import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Input from '../src/components/Input';
import IconButton from '../src/components/IconButton';
import LocalBridgeApp from '../src/entrypoints/local-bridge/LocalBridgeApp';
import { LocalBridgeClient } from '../src/services/signing/localBridge/client';
import browser from './helpers/browser-mock';

test('input actions remain labeled and reserve space beside password visibility', () => {
 const html=renderToStaticMarkup(createElement(Input,{type:'password',showToggle:true,label:'Pairing code',actions:[createElement(IconButton,{'aria-label':'Camera',key:'camera',children:'C'}),createElement(IconButton,{'aria-label':'Sound',key:'sound',children:'S'})]}));
 const dom=new JSDOM(html);const input=dom.window.document.querySelector('input')!;
 assert.equal(input.style.paddingRight,'132px');assert.equal(dom.window.document.querySelectorAll('button').length,3);
 assert.ok(dom.window.document.querySelector('[aria-label="Camera"]'));assert.ok(dom.window.document.querySelector('[aria-label="Sound"]'));dom.window.close();
});
for (const mode of ['wifi','ble'] as const) test(`${mode} paste advances without a connect button`, async t => {
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
  assert.ok(document.querySelector('[aria-label="localBridge.sound"]'));
  const back=[...document.querySelectorAll('button')].find(b=>b.textContent==='common.back')!;
  assert.equal(back.parentElement?.tagName,'DIV');assert.equal(back.nextElementSibling?.tagName,'DIV');
  const uri=`nwlan://${'11'.repeat(32)}?v=2&psk=${Buffer.alloc(32,2).toString('base64url')}&addr=192.168.1.2:54211`;
  await act(async()=>{const paste=new dom.window.Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(paste,'clipboardData',{value:{getData:()=>uri}});document.querySelector('input')!.dispatchEvent(paste);});
  assert.equal(attempts,1);
  assert.ok(![...document.querySelectorAll('button')].some(b=>b.textContent==='localBridge.connect'));
 } finally {await act(async()=>root.unmount());dom.window.close();if(previous)Object.defineProperty(globalThis,'navigator',previous);else Reflect.deleteProperty(globalThis,'navigator');}
});
