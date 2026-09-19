import { resetWotDatabase } from './helpers/wot-storage.ts';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import browser from '../src/lib/browser.ts';
import { resetMockStorage, hasAlarm } from './helpers/browser-mock.ts';
import { relaySocket } from './helpers/wot-relay.ts';
import { signEvent } from '../src/lib/crypto/nip01.ts';
import { getPublicKey } from '../src/lib/crypto/secp256k1.ts';
import { bytesToHex } from '../src/lib/crypto/utils.ts';
import { WOT_SETTINGS_KEY, WOT_AUTO_SYNC_ALARM, WOT_DEFAULTS, WOT_GRAPH_PREFIX, WOT_SCORING, WOT_SYNC_STATUS_KEY } from '../src/constants/wot.ts';
import { getWotSettings, saveWotSettings, invalidateWot, wotContext } from '../src/services/wot/state.ts';
import { installWotAutoSync } from '../src/services/wot/automatic.ts';
import { queryWot } from '../src/services/wot/queries.ts';
import { getWotDatabases } from '../src/services/wot/databases.ts';
import { validateWotScoring, validateWotSettings } from '../src/domain/wot/validation.ts';
import { graphDetails, trustScore } from '../src/domain/wot/graph.ts';
import { seedRelayCache } from '../src/services/relays/relayCache.ts';
import { MUTE_LIST_CACHE } from '../src/constants/relays.ts';
let eventTimeBase = 0;
const originalSocket = globalThis.WebSocket, originalFetch = globalThis.fetch;
afterEach(async () => { eventTimeBase = 0; invalidateWot(); resetMockStorage(); await resetWotDatabase(); globalThis.WebSocket = originalSocket; globalThis.fetch = originalFetch; });
const keys = [31, 32, 33, 34].map(n => new Uint8Array(32).fill(n));
const [a,b,c,d] = keys.map(key => bytesToHex(getPublicKey(key)));
async function event(index: number, kind: number, time: number, follows: string[]) {
    return signEvent({ pubkey: bytesToHex(getPublicKey(keys[index])), kind, created_at: time + eventTimeBase, content: '', tags: follows.map(p => ['p',p]) }, keys[index]);
}
async function account() {
    await browser.storage.local.set({ accounts: [{ id: 'a', pubkey: a, type: 'npub', name: 'Alice' }, { id: 'b', pubkey: b, type: 'npub', name: 'Bob' }], activeAccountId: 'a' });
    await browser.storage.sync.set({ relays: 'wss://relay.test' });
    await saveWotSettings({ enabled: true });
}
test('automatic sync applies additions, removals, mutes, unmuting and account isolation', async t => {
    let now = Date.now();
    eventTimeBase = Math.floor(now/1000);
    t.mock.method(Date,'now',()=>now);
    await account();
    let alarm: (alarm: {name:string}) => void = () => {};
    t.mock.method(browser.alarms.onAlarm, 'addListener', (fn: (alarm: { name: string }) => void) => { alarm = fn; });
    const progress: any[] = [];
    const listener = (changes: any) => { if (changes[WOT_SYNC_STATUS_KEY]) progress.push(changes[WOT_SYNC_STATUS_KEY].newValue); };
    browser.storage.onChanged.addListener(listener);
    const controller = installWotAutoSync();
    const tick = async () => { now += 86400000; alarm({ name: WOT_AUTO_SYNC_ALARM }); await controller.settled(); };
    try {
        await controller.settled();
        assert.equal(hasAlarm(WOT_AUTO_SYNC_ALARM), false);
        let root = await event(0,3,10,[b]);
        relaySocket([root, await event(1,3,10,[c]), await event(0,10000,10,[])]);
        await saveWotSettings({ enabled: true, autoSync: true });
        await controller.settled();
        assert.equal(hasAlarm(WOT_AUTO_SYNC_ALARM), true);
        assert.equal((await wotContext()).graph, null, 'enabling waits for the daily alarm');
        await tick();
        assert.equal(await queryWot('getDistance', {target:c}), 2);
        assert.ok(progress.some(p => p.running && p.depth === 1));
        assert.ok(progress.some(p => p.running && p.depth === 2));
        assert.equal(progress.at(-1).phase, 'complete');
        assert.equal(progress.at(-1).people, 2);
        relaySocket([root, await event(1,3,11,[c,d])]);
        await tick();
        assert.equal(await queryWot('getDistance', {target:d}), 2);
        relaySocket([root, await event(1,3,12,[d]), await event(0,10000,12,[b])]);
        await tick();
        assert.equal(await queryWot('getTrustScore', {target:b}), 0);
        assert.equal(await queryWot('getPath', {target:d}), null);
        relaySocket([root, await event(1,3,12,[d]), await event(0,10000,13,[])]);
        await tick();
        assert.equal(await queryWot('getTrustScore', {target:d}), 0.5);
        assert.equal(await queryWot('getDistance', {target:c}), null);
        // Older relays must not restore a removed follow or mute.
        relaySocket([root, await event(1,3,10,[c]), await event(0,10000,12,[b])]);
        await tick();
        assert.equal(await queryWot('getDistance', {target:c}), null);
        assert.equal(await queryWot('getTrustScore', {target:d}), 0.5);
        // An empty root list prunes every previously reachable branch.
        root = await event(0,3,20,[]);
        relaySocket([root]);
        await tick();
        assert.deepEqual((await wotContext()).graph?.follows, {[a]:[]});
        assert.equal(await queryWot('getDistance', {target:b}), null);
        // Switching accounts waits until the next daily tick.
        relaySocket([await event(1,3,21,[d])]);
        await browser.storage.local.set({activeAccountId:'b'});
        await controller.settled();
        assert.equal((await wotContext()).graph, null);
        await tick();
        assert.equal(await queryWot('getDistance', {target:d}), 1);
        const databases = await getWotDatabases();
        assert.equal(databases.databases.length, 2);
        assert.equal(databases.accounts, 2);
        assert.ok(databases.bytes > 0);
        assert.equal(databases.estimated, true);
        assert.deepEqual(databases.databases.map(db => db.name).sort(), ['Alice','Bob']);
        const sockets = relaySocket([]);
        await saveWotSettings({enabled:false,autoSync:true});
        await controller.settled();
        await tick();
        assert.equal(hasAlarm(WOT_AUTO_SYNC_ALARM), false);
        assert.equal(sockets().calls, 0);
    } finally { await controller.stop(); browser.storage.onChanged.removeListener(listener); }
});

test('automatic alarm skips busy syncs, ignores unrelated updates, and survives errors', async t => {
    let alarm: (alarm:{name:string}) => void = () => {};
    t.mock.method(browser.alarms.onAlarm, 'addListener', (fn: (alarm: { name: string }) => void) => { alarm = fn; });
    let busy = true, calls = 0;
    const controller = installWotAutoSync({ settings: async () => ({...WOT_DEFAULTS,enabled:true,autoSync:true}), busy: () => busy, sync: async () => {calls++; throw new Error('offline');} });
    try {
        await controller.settled();
        alarm({name:WOT_AUTO_SYNC_ALARM}); await controller.settled();
        assert.equal(calls,0);
        busy = false;
        await browser.storage.local.set({unrelated:'value'}); await controller.settled();
        assert.equal(calls,0);
        alarm({name:WOT_AUTO_SYNC_ALARM}); await controller.settled();
        assert.equal(calls,1);
        assert.equal(hasAlarm(WOT_AUTO_SYNC_ALARM),true);
        alarm({name:WOT_AUTO_SYNC_ALARM}); await controller.settled();
        assert.equal(calls,2);
    } finally {await controller.stop();}
});

test('custom scoring is validated, applies to local and cached oracle results, and never bypasses mutes', async () => {
    const scoring = structuredClone(WOT_SCORING);
    scoring.distanceWeights[2] = 0.4; scoring.pathBonus[2] = 0.2; scoring.maxPathBonus = 0.3;
    assert.equal(trustScore(2,2,scoring), 0.6000000000000001);
    assert.equal(trustScore(2,100,scoring), 0.7);
    for (const value of [-1,1.1,NaN,Infinity]) assert.throws(() => validateWotScoring({...scoring,maxPathBonus:value}));
    assert.throws(() => validateWotScoring({...scoring,distanceWeights:{...scoring.distanceWeights,1:0.1}}));
    assert.throws(() => validateWotSettings({autoSync:'yes' as never}));
    await account();
    const graph = {root:a,follows:{[a]:[b,c],[b]:[d],[c]:[d]},relays:{},updatedAt:1,truncated:false};
    await browser.storage.local.set({[WOT_GRAPH_PREFIX+'a']:graph});
    await saveWotSettings({enabled:true,scoring});
    assert.equal((await getWotSettings()).scoring.distanceWeights[2],0.4);
    assert.equal(await queryWot('getTrustScore',{target:d}),0.6000000000000001);
    assert.equal(graphDetails(graph,d,2,new Set([b]),scoring)?.score,0.4);
    await saveWotSettings({enabled:true,mode:'remote',oracleUrl:'https://oracle.test',scoring});
    let requests = 0;
    globalThis.fetch = async () => {requests++;return new Response(JSON.stringify({hops:2,paths:2}));};
    assert.equal(await queryWot('getTrustScore',{target:d}),0.6000000000000001);
    await saveWotSettings({enabled:true,mode:'remote',oracleUrl:'https://oracle.test',scoring:{...scoring,maxPathBonus:0}});
    assert.equal(await queryWot('getTrustScore',{target:d}),0.4);
    assert.equal(requests,1);
    await seedRelayCache(MUTE_LIST_CACHE,a,{people:[d],rawContent:'',words:[],hashtags:[],events:[],createdAt:10,reachable:true});
    assert.equal(await queryWot('getTrustScore',{target:d}),0);
    assert.equal(requests,1);
});

test('database inventory uses IDB payload estimates and excludes unrelated keys', async () => {
    await account();
    const graph = {root:a,follows:{[a]:[b]},relays:{},updatedAt:1,truncated:false};
    await browser.storage.local.set({[WOT_GRAPH_PREFIX+'a']:graph, vault:'private', wallet:'private'});
    const inventory = await getWotDatabases();
    assert.ok(inventory.bytes>0);
    assert.equal(inventory.estimated,true);
    assert.equal(inventory.databases[0].people,1);
    assert.ok(!JSON.stringify(inventory).includes('private'));
});

test('disabling during sync cancels without replacing the previous graph', async t => {
    await account();
    const previous = {root:a,follows:{[a]:[b]},relays:{},updatedAt:1,truncated:false};
    await browser.storage.local.set({[WOT_GRAPH_PREFIX+'a']:previous});
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release=resolve;});
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => {entered=resolve;});
    t.mock.method(browser.storage.sync,'get', async () => {entered();await gate;return {relays:'wss://relay.test'};});
    const {syncWotGraph}=await import('../src/services/wot/sync.ts');
    const pending=syncWotGraph();
    const rejection=assert.rejects(pending,/changed/);
    await waiting;
    await saveWotSettings({enabled:false});
    release();
    await rejection;
    assert.deepEqual((await wotContext(false)).graph,previous);
    const progress=(await browser.storage.local.get(WOT_SYNC_STATUS_KEY))[WOT_SYNC_STATUS_KEY] as any;
    assert.equal(progress.running,false);
    assert.equal(progress.phase,'cancelled');
});

test('progress survives worker restart and throttles repeated notifications', async t => {
    await browser.storage.local.set({[WOT_SYNC_STATUS_KEY]:{accountId:'a',running:true,phase:'fetching'}});
    const fresh = await import(new URL('../src/services/wot/progress.ts?restart-test',import.meta.url).href);
    assert.equal((await fresh.getWotProgress()).phase,'cancelled');
    t.mock.method(Date,'now',()=>10000);
    let writes=0;
    const listen=(changes:any)=>{if(changes[WOT_SYNC_STATUS_KEY]) writes++;};
    browser.storage.onChanged.addListener(listen);
    try {
        await fresh.reportWotProgress({accountId:'a',running:true,phase:'fetching'},true);
        for(let i=0;i<100;i++) await fresh.reportWotProgress({authors:i});
        assert.equal(writes,1);
        assert.equal((await fresh.getWotProgress()).authors,99);
        await fresh.reportWotProgress({running:false,phase:'complete'},true);
        assert.equal(writes,2);
    } finally {browser.storage.onChanged.removeListener(listen);}
});

test('compact graphs roundtrip, reject invalid references and share traversal across targets', async () => {
    const {packGraph,unpackGraph} = await import('../src/domain/wot/encoding.ts');
    const {graphLookup} = await import('../src/domain/wot/graph.ts');
    const graph = {root:a,follows:{[a]:[b,c],[b]:[c,d],[c]:[d]},relays:{},listVersions:{[a+':3']:{createdAt:123,id:'event'}},updatedAt:1,truncated:false};
    const packed = packGraph(graph);
    assert.deepEqual(unpackGraph(packed),graph);
    assert.equal(unpackGraph(graph),graph);
    assert.equal(unpackGraph(null),null);
    assert.equal(unpackGraph({...packed,root:100}),null);
    assert.equal(unpackGraph({...packed,format:2} as any),null);
    assert.equal(unpackGraph({...packed,follows:[[0,[-1]]]}),null);
    let reads=0;
    const monitored = {...graph,follows:new Proxy(graph.follows,{get(target,key){reads++;return Reflect.get(target,key);}})};
    const lookup=graphLookup(monitored,3);
    const initialReads=reads;
    for(let i=0;i<100;i++) assert.deepEqual(lookup(d),graphDetails(graph,d,3));
    assert.equal(reads,initialReads);
    assert.equal(graphLookup(graph,3,new Set([b,c]))(d),null);
    const dense={...graph,follows:Object.fromEntries([a,b,c,d].map(key=>[key,[a,b,c,d]]))};
    assert.ok(JSON.stringify(packGraph(dense)).length<JSON.stringify(dense).length);
});

test('edge limits default to unlimited and custom limits constrain sync', async () => {
    assert.equal(validateWotSettings({}).maxEdges,null);
    for(const maxEdges of [0,-1,1.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>validateWotSettings({maxEdges}),/Edge limit/);
    await account();
    relaySocket([await event(0,3,10,[b,c,d]),await event(1,3,10,[c,d])]);
    const {syncWotGraph}=await import('../src/services/wot/sync.ts');
    await saveWotSettings({enabled:true,maxEdges:2});
    let graph=await syncWotGraph();
    assert.equal(Object.values(graph.follows).flat().length,2);
    assert.equal(graph.truncated,true);
    await saveWotSettings({enabled:true,maxEdges:null});
    graph=await syncWotGraph();
    assert.deepEqual(graph.follows[a],[b,c,d]);
    assert.equal(Object.values(graph.follows).flat().length,5);
    assert.equal((await getWotSettings()).maxEdges,null);
});

test('profile limits default to unlimited and raising a cap fetches previously skipped lists', async () => {
    assert.equal(validateWotSettings({}).maxAuthors,null);
    for(const maxAuthors of [0,-1,1.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>validateWotSettings({maxAuthors}),/Profile limit/);
    await account();
    relaySocket([await event(0,3,10,[b,c]),await event(1,3,10,[d]),await event(2,3,10,[])]);
    const {syncWotGraph}=await import('../src/services/wot/sync.ts');
    await saveWotSettings({enabled:true,maxAuthors:1});
    let graph=await syncWotGraph();
    assert.deepEqual(Object.keys(graph.follows),[a]);
    assert.equal(graph.truncated,true);
    await saveWotSettings({enabled:true,maxAuthors:null});
    graph=await syncWotGraph();
    assert.equal(Object.keys(graph.follows).length,3);
    assert.deepEqual(graph.follows[b],[d]);
    assert.equal(graph.truncated,false);
});

test('follows per profile default to unlimited, including lists longer than 1000', async () => {
    assert.equal(validateWotSettings({}).maxFollows,null);
    for (const maxFollows of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>validateWotSettings({maxFollows}),/Follows per profile/);
    await account();
    const follows=Array.from({length:1101},(_,i)=>(i+1000).toString(16).padStart(64,'0'));
    relaySocket([await event(0,3,10,follows)]);
    const {syncWotGraph}=await import('../src/services/wot/sync.ts');
    await saveWotSettings({enabled:true,maxHops:1});
    let graph=await syncWotGraph();
    assert.equal(graph.follows[a].length,1101);
    assert.equal(graph.truncated,false);
    await saveWotSettings({enabled:true,maxHops:1,maxFollows:10});
    graph=await syncWotGraph();
    assert.equal(graph.follows[a].length,10);
    assert.equal(graph.truncated,true);
    await saveWotSettings({enabled:true,maxHops:1,maxFollows:null});
    graph=await syncWotGraph();
    assert.deepEqual(graph.follows[a],follows);
    assert.equal(graph.truncated,false);
});

test('overlapping paths and cycles fetch each author once per relay in a sync', async () => {
    await account();
    await browser.storage.sync.set({relays:'wss://one.test,wss://two.test'});
    await saveWotSettings({enabled:true,maxHops:3});
    const stats=relaySocket([await event(0,3,10,[b,c,b]),await event(1,3,10,[a,c,d]),await event(2,3,10,[a,b,d]),await event(3,3,10,[a,b,c])]);
    const {syncWotGraph}=await import('../src/services/wot/sync.ts');
    const graph=await syncWotGraph();
    for (const key of [a,b,c,d]) assert.equal(stats().requests.flat().filter(pk=>pk===key).length,2);
    for (const request of stats().requests) assert.equal(new Set(request).size,request.length);
    assert.equal(graph.truncated,false);
    const progress=(await browser.storage.local.get(WOT_SYNC_STATUS_KEY))[WOT_SYNC_STATUS_KEY] as any;
    assert.equal(progress.authors,4);
    assert.equal(progress.lists,4);
    assert.equal(progress.people,3);
    // A new sync deliberately checks for edits instead of trusting old lists forever.
    await syncWotGraph();
    for (const key of [a,b,c,d]) assert.equal(stats().requests.flat().filter(pk=>pk===key).length,4);
});

test('oracle public-key lists no longer have a hidden 1000-entry cap', async () => {
    const {WotOracle}=await import('../src/services/wot/oracle.ts');
    const follows=Array.from({length:1101},(_,i)=>(i+1000).toString(16).padStart(64,'0'));
    const oracle=new WotOracle('https://oracle.test',new AbortController().signal,async()=>new Response(JSON.stringify({follows,common:follows})));
    assert.deepEqual(await oracle.follows(a),follows);
    assert.deepEqual(await oracle.common(a,b),follows);
});

test('automatic ticks during a long sync do not queue redundant refreshes', async t => {
    let alarm: (alarm:{name:string}) => void = () => {};
    t.mock.method(browser.alarms.onAlarm,'addListener',(fn:typeof alarm)=>{alarm=fn;});
    let calls=0, busy=false, release=()=>{};
    const controller=installWotAutoSync({settings:async()=>({...WOT_DEFAULTS,enabled:true,autoSync:true}),busy:()=>busy,sync:async()=>{
        calls++; busy=true;
        await new Promise<void>(resolve=>{release=resolve;});
        busy=false;
        return {root:a,follows:{},relays:{},updatedAt:0,truncated:false};
    }});
    try {
        await controller.settled();
        alarm({name:WOT_AUTO_SYNC_ALARM});
        alarm({name:WOT_AUTO_SYNC_ALARM}); // also coalesce before the first sync starts
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(calls,1);
        for(let i=0;i<3;i++) alarm({name:WOT_AUTO_SYNC_ALARM});
        release(); await controller.settled();
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(calls,1);
        alarm({name:WOT_AUTO_SYNC_ALARM});
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(calls,2);
        release(); await controller.settled();
    } finally {release();await controller.stop();}
});

test('incremental sync reuses fresh public lists, queries updates and reconciles backdated lists',async t=>{
    let now=Date.now();t.mock.method(Date,'now',()=>now);
    await account();
    const {syncWotGraph}=await import('../src/services/wot/sync.ts');
    const root=await event(0,3,Math.floor(now/1000)-100,[b]);
    const first=await event(1,3,Math.floor(now/1000)-100,[c]);
    relaySocket([root,first]);
    await syncWotGraph();
    let stats=relaySocket([root,first]);
    await syncWotGraph({incremental:true});
    assert.deepEqual(stats().requests.flat(),[a]); // fresh b reused
    now+=300000;
    const changed=await event(1,3,Math.floor(now/1000),[d]);
    stats=relaySocket([root,changed]);
    await syncWotGraph({incremental:true});
    assert.deepEqual((await wotContext()).graph?.follows[b],[d]);
    assert.ok(stats().filters.flat().some(filter=>filter.authors?.includes(b) && filter.since!==undefined));
    // A delayed, backdated (but newer than prior known) replacement needs a full scan.
    const backdated=await event(1,3,Math.floor(now/1000)+1,[]);
    now+=900000;
    relaySocket([root]);
    await syncWotGraph({incremental:true}); // advance the last checked time with no update
    now+=300000;
    relaySocket([root,backdated]);
    await syncWotGraph({incremental:true});
    assert.deepEqual((await wotContext()).graph?.follows[b],[d]);
    now+=24*60*60*1000;
    stats=relaySocket([root,backdated]);
    await syncWotGraph({incremental:true});
    assert.deepEqual((await wotContext()).graph?.follows[b],[]);
    assert.ok(stats().filters.flat().some(filter=>filter.authors?.includes(b) && filter.since===undefined));
});

test('newly reachable authors are fetched and older relay lists cannot overwrite newer ones',async()=>{
    await account();
    const {syncWotGraph}=await import('../src/services/wot/sync.ts');
    const relayEvent=async(time:number,url:string)=>signEvent({pubkey:a,kind:10002,created_at:time,content:'',tags:[['r',url]]},keys[0]);
    relaySocket([await event(0,3,10,[b]),await event(1,3,10,[]),await relayEvent(20,'wss://new.test')]);
    await syncWotGraph();
    const stats=relaySocket([await event(0,3,30,[b,c]),await event(2,3,10,[d]),await relayEvent(10,'wss://old.test')]);
    await syncWotGraph({incremental:true});
    assert.ok(stats().requests.flat().includes(c));
    assert.ok(!stats().requests.flat().includes(b));
    assert.deepEqual((await wotContext()).graph?.follows[c],[d]);
    assert.equal((await wotContext()).graph?.relays[a][0].url,'wss://new.test');
    const {publicListSummary}=await import('../src/services/wot/public-lists.ts');
    const summary=await publicListSummary();
    assert.equal(summary.records,3);assert.ok(summary.bytes>0);
});

test('daily scheduler replaces old five-minute alarms and does not sync on settings/account changes', async t => {
    let current: { name: string; periodInMinutes: number } | undefined = {name: WOT_AUTO_SYNC_ALARM, periodInMinutes: 5};
    let creations = 0, syncs = 0;
    t.mock.method(browser.alarms, 'get', async () => current);
    t.mock.method(browser.alarms, 'create', async (name: string, info: {periodInMinutes: number}) => {
        current = { name, periodInMinutes: info.periodInMinutes }; creations++;
    });
    const controller = installWotAutoSync({ settings: async () => ({...WOT_DEFAULTS, enabled: true, autoSync: true}), busy: () => false, sync: async () => { syncs++; return {root:a, follows:{}, relays:{}, updatedAt:0, truncated:false}; } });
    try {
        await controller.settled();
        assert.equal(current?.periodInMinutes, 1440);
        assert.equal(creations, 1);
        await browser.storage.local.set({activeAccountId: 'other'});
        await controller.settled();
        await browser.storage.local.set({[WOT_SETTINGS_KEY]: {...WOT_DEFAULTS, enabled: true, autoSync: true}});
        await controller.settled();
        assert.equal(creations, 1, 'valid daily alarm must retain its scheduled time');
        assert.equal(syncs, 0);
    } finally { await controller.stop(); }
});
