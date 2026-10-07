import {it} from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {publicProfile,profileDisplayName,freshProfileEntry} from '../src/domain/profile/publicProfile';
import ProfileSummary from '../src/components/ProfileSummary';
import SenderProfile from '../src/components/EventDetailModal/SenderProfile';
import browser,{resetMockStorage} from './helpers/browser-mock.ts';
import {PROFILE_CACHE_TTL_MS} from '../src/constants/profile';

it('browser aliases share the same mocked storage and RPC instance', async () => {
 const extensionless = await import('@lib/browser');
 const explicit = await import('@lib/browser.ts');
 assert.equal(extensionless.default, browser);
 assert.equal(explicit.default, browser);
});

it('public display validates metadata and shares name precedence across both layouts',()=>{
 assert.equal(publicProfile([]),null);assert.equal(publicProfile('name'),null);
 const meta=publicProfile({display_name:'Preferred',name:'Legacy',picture:5});
 assert.deepEqual(meta,{display_name:'Preferred',name:'Legacy'});
 assert.equal(profileDisplayName({display_name:' ',name:'Legacy'}),'Legacy');
 assert.equal(profileDisplayName(null,'key'),'key');
 for(const compact of [false,true]) {
  const html=renderToStaticMarkup(createElement(ProfileSummary,{meta,compact}));
  assert.ok(html.includes('Preferred'));assert.ok(!html.includes('Legacy'));
 }
 const now=Date.now();
 for(const fetchedAt of [now+1,now-PROFILE_CACHE_TTL_MS,NaN,Infinity]) assert.equal(freshProfileEntry({metadata:{},fetchedAt},now),false);
 assert.equal(freshProfileEntry({metadata:[],fetchedAt:now},now),false);
 assert.equal(freshProfileEntry({metadata:{},fetchedAt:now},now),true);
});

it('shared public-profile hook rejects future cache and ignores an obsolete directory reply',async t=>{
 resetMockStorage();const a='a'.repeat(64),b='b'.repeat(64);
 await browser.storage.local.set({[`profile_${a}`]:{metadata:{name:'Future cache'},fetchedAt:Date.now()+60000}});
 const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(document.getElementById('root')!);let resolve!:(value:unknown)=>void;const calls:any[]=[];
 t.mock.method(browser.runtime,'sendMessage',async (message: unknown)=>{calls.push(message);return new Promise(done=>{resolve=done;});});
 try {
  await act(async()=>root.render(createElement(SenderProfile,{pubkey:a})));
  assert.equal(calls.length,1);assert.ok(!document.body.textContent?.includes('Future cache'));
  await act(async()=>root.render(createElement(SenderProfile,{pubkey:b,lookup:false})));
  await act(async()=>resolve({result:{name:'Obsolete sender'}}));
  assert.ok(!document.body.textContent?.includes('Obsolete sender'));assert.equal(calls.length,1);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});

it('read-only cached profile display can reuse stale and account metadata safely', async () => {
  const { cachedPublicProfile } = await import('../src/domain/profile/publicProfile.ts');
  const key = 'a'.repeat(64);
  assert.deepEqual(cachedPublicProfile({ [`profile_${key}`]: { metadata: { name: 'Alice', picture: 42 }, fetchedAt: 0 } }, key), { name: 'Alice' });
  assert.deepEqual(cachedPublicProfile({ profileCache: { [key]: { name: 'Alice' } } }, key), { name: 'Alice' });
  assert.equal(cachedPublicProfile({ profileCache: false, [`profile_${key}`]: null }, key), null);
});
