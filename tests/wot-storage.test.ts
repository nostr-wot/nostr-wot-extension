import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {resetWotDatabase} from './helpers/wot-storage.ts';
import {resetMockStorage} from './helpers/browser-mock.ts';
import browser from '../src/lib/browser.ts';
import {commitSnapshot,readSnapshot,snapshotSummary,removeSnapshot,snapshotKeys} from '../src/services/wot/snapshots.ts';
import {databaseRead} from '../src/services/wot/database.ts';
import {WOT_GRAPH_PREFIX,WOT_SYNC_STATUS_KEY} from '../src/constants/wot.ts';
import {getWotState} from '../src/services/background/wot-handlers.ts';
import {getWotDatabases} from '../src/services/wot/databases.ts';
const a='11'.repeat(32),b='22'.repeat(32),key=WOT_GRAPH_PREFIX+'a';
const graph={root:a,follows:{[a]:[b]},relays:{},updatedAt:1,truncated:false};
afterEach(async()=>{resetMockStorage();await resetWotDatabase();});
test('snapshots commit to IDB with small local pointers and coalesce cold loads',async()=>{
    const summary=await commitSnapshot(key,graph);
    assert.equal(((await browser.storage.local.get(key))[key] as {format:string}).format,'wot-indexeddb');
    assert.ok(JSON.stringify((await browser.storage.local.get(key))[key]).length<1000);
    assert.ok(await databaseRead('snapshots',summary.revision));
    await browser.storage.local.set({activeAccountId:'a'}); // invalidate warm cache
    const [first,second]=await Promise.all([readSnapshot(key),readSnapshot(key)]);
    assert.equal(first,second);
    assert.equal(await readSnapshot(key),first);
    assert.equal((await snapshotSummary(key))?.edges,1);
    await commitSnapshot(key,{...graph,updatedAt:2,follows:{[a]:[]}});
    assert.notEqual(await readSnapshot(key),first);
    assert.equal(await databaseRead('snapshots',summary.revision),undefined);
});
test('failed pointer publication and cancelled writes preserve the previous graph',async t=>{
    const old=await commitSnapshot(key,graph);
    const set=browser.storage.local.set.bind(browser.storage.local);
    t.mock.method(browser.storage.local,'set',async(value:any)=>{
        if(value[key]) throw new DOMException('quota','QuotaExceededError');
        return set(value);
    });
    await assert.rejects(commitSnapshot(key,{...graph,updatedAt:2}),/quota/);
    assert.equal((await snapshotSummary(key))?.revision,old.revision);
    assert.deepEqual(await readSnapshot(key),graph);
    const controller=new AbortController();controller.abort();
    await assert.rejects(commitSnapshot(key,{...graph,updatedAt:3},controller.signal),/abort/i);
    assert.deepEqual(await readSnapshot(key),graph);
});
test('legacy snapshots migrate once, isolate accounts and can be cleared',async()=>{
    await browser.storage.local.set({[key]:graph});
    const values=await Promise.all([readSnapshot(key),readSnapshot(key)]);
    assert.equal(values[0],values[1]);
    const other=WOT_GRAPH_PREFIX+'b';
    await commitSnapshot(other,{...graph,root:b});
    assert.deepEqual(new Set(await snapshotKeys([])),new Set([key,other]));
    await removeSnapshot(key);
    assert.equal(await readSnapshot(key),null);
    assert.equal((await readSnapshot(other))?.root,b);
    assert.deepEqual(await snapshotKeys([]),[other]);
});
test('progress state and inventory do not open or decode graph payloads',async t=>{
    await browser.storage.local.set({accounts:[{id:'a',pubkey:a,type:'npub',name:'Alice'}],activeAccountId:'a'});
    await commitSnapshot(key,graph);
    // Clearing the native object store makes an accidental graph load fail.
    await resetWotDatabase();
    const original=browser.storage.local.get.bind(browser.storage.local);
    t.mock.method(browser.storage.local,'get',async(keys:any)=>{assert.notEqual(keys,null);return original(keys);});
    for(let i=0;i<20;i++) {
        await browser.storage.local.set({[WOT_SYNC_STATUS_KEY]:{accountId:'a',running:false,authors:i}});
        assert.equal((await getWotState()).people,1);
    }
    assert.equal((await getWotDatabases()).databases[0].people,1);
});

test('crash recovery removes abandoned stages but preserves committed generations',async()=>{
    const {databaseWrite,databaseKeys}=await import('../src/services/wot/database.ts');
    const {collectOrphanSnapshots}=await import('../src/services/wot/snapshots.ts');
    const summary=await commitSnapshot(key,graph);
    await databaseWrite('snapshots',[['abandoned-stage',{partial:true}]]);
    await collectOrphanSnapshots();
    assert.deepEqual(await databaseKeys('snapshots'),[summary.revision]);
    assert.deepEqual(await readSnapshot(key),graph);
});

test('follow guard uses synced public lists offline without undoing newer signed removals',async()=>{
 const {savePublicLists}=await import('../src/services/wot/public-lists.ts');
 const {followReplacementCount,rememberSignedFollowList}=await import('../src/services/signing/followListGuard.ts');
 const {signEvent}=await import('../src/lib/crypto/nip01.ts');
 const {relaySocket}=await import('./helpers/wot-relay.ts');
 const secret=new Uint8Array(32).fill(1);
 const event=await signEvent({kind:3,content:'',tags:[['p',a]],created_at:20},secret);
 const socket=globalThis.WebSocket;
 try {
  const stats=relaySocket([],true);
  await savePublicLists([{pubkey:event.pubkey,scope:'test',checkedAt:1,fullCheckedAt:1,follows:[a,b],followVersion:{createdAt:10,id:'a'}}]);
  assert.equal(await followReplacementCount(event,event.pubkey),2);
  assert.equal(stats().calls,0,'synced evidence needs no relay round trip');
  assert.equal(await followReplacementCount(event,a),undefined,'records are scoped to the author');
  await rememberSignedFollowList(event);
  assert.equal(await followReplacementCount(event,event.pubkey),undefined,'older graph does not override a newer signed list');
 } finally {globalThis.WebSocket=socket;}
});
