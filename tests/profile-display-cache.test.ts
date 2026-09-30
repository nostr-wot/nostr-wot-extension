import {it} from 'node:test';
import assert from 'node:assert/strict';
import browser,{resetMockStorage} from './helpers/browser-mock';
import {maintainProfileCache} from '../src/services/profile/displayCache';
import {profileCache} from '../src/services/background/state';
import {PROFILE_CACHE_TTL_MS,PROFILE_CACHE_MAX_ENTRIES} from '../src/constants/profile';
it('shared profile cache expires entries and bounds concurrent writes without deleting unrelated storage',async()=>{
 resetMockStorage();profileCache.clear();const now=Date.now();
 const entries=Object.fromEntries(Array.from({length:PROFILE_CACHE_MAX_ENTRIES+5},(_,i)=>[`profile_${i.toString(16).padStart(64,'0')}`,{metadata:{name:String(i)},fetchedAt:now-i}]));
 entries[`profile_${'f'.repeat(64)}`]={metadata:{name:'expired'},fetchedAt:now-PROFILE_CACHE_TTL_MS-1};
 await browser.storage.local.set({...entries,language:'en'});
 await maintainProfileCache();
 const all=await browser.storage.local.get(null);
 assert.equal(Object.keys(all).filter(k=>k.startsWith('profile_')).length,PROFILE_CACHE_MAX_ENTRIES);
 assert.equal(profileCache.size,PROFILE_CACHE_MAX_ENTRIES);assert.equal(all.language,'en');
 assert.equal(all[`profile_${'f'.repeat(64)}`],undefined);
 await Promise.all(['a','b','c'].map(key=>maintainProfileCache(key.repeat(64),{metadata:{name:key},fetchedAt:Date.now()})));
 assert.equal(profileCache.size,PROFILE_CACHE_MAX_ENTRIES);
 assert.equal(Object.keys(await browser.storage.local.get(null)).filter(k=>k.startsWith('profile_')).length,PROFILE_CACHE_MAX_ENTRIES);
});

it('routine reads use the index and one profile key, including a worker restart and storage deletion', async t => {
 resetMockStorage(); profileCache.clear();
 const {readProfileCache}=await import('../src/services/profile/displayCache');
 const pk='d'.repeat(64), key=`profile_${pk}`;
 await maintainProfileCache(pk,{metadata:{name:'Fresh'},fetchedAt:Date.now()});
 const get=browser.storage.local.get.bind(browser.storage.local);
 const reads:unknown[]=[];
 t.mock.method(browser.storage.local,'get',async (keys: Parameters<typeof get>[0])=>{reads.push(keys);return get(keys);});
 profileCache.clear(); // Worker restart: disk index is sufficient.
 assert.equal((await readProfileCache(pk))?.metadata.name,'Fresh');
 assert.ok(!reads.includes(null));
 assert.deepEqual(reads,['publicProfileIndexV1',key]);
 await browser.storage.local.remove(key);
 assert.equal(profileCache.has(pk),false);
 assert.equal(await readProfileCache(pk),null);
 await browser.storage.local.clear();
 assert.equal(await readProfileCache(pk),null);
});

it('migration rejects future dates, invalid metadata and never removes unrelated index keys',async()=>{
 resetMockStorage();profileCache.clear();
 const {readProfileCache}=await import('../src/services/profile/displayCache');
 const pk='e'.repeat(64);
 await browser.storage.local.set({[`profile_${pk}`]:{metadata:{name:'future'},fetchedAt:Date.now()+60000},unrelated:{secret:'preserved'}});
 await maintainProfileCache();
 assert.equal(await readProfileCache(pk),null);
 assert.deepEqual((await browser.storage.local.get('unrelated')).unrelated,{secret:'preserved'});
 await browser.storage.local.set({publicProfileIndexV1:{unrelated:0}});
 await maintainProfileCache();
 assert.deepEqual((await browser.storage.local.get('unrelated')).unrelated,{secret:'preserved'});
});
