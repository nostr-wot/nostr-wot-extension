import assert from 'node:assert/strict';
import test from 'node:test';
import { graphDetails, graphLookup, graphPath, graphStats } from '../src/domain/wot/graph.ts';
import { packGraph, unpackGraph } from '../src/domain/wot/encoding.ts';
import { WOT_SCORING } from '../src/constants/wot.ts';
import type { WotGraph } from '../src/domain/wot/types.ts';
const key = (i: number) => i.toString(16).padStart(64, '0');
const [a,b,c,d,e] = [1,2,3,4,5].map(key);
const fixture = (): WotGraph => ({root:a,follows:{[a]:[b,c,b],[b]:[a,d],[c]:[d],[e]:[]},relays:{},updatedAt:1,truncated:false});

test('repeated pure queries reuse normalization and breadth-first traversal', () => {
    let reads=0, muteChecks=0;
    const graph=fixture();
    graph.follows=new Proxy(graph.follows,{get(target,key){reads++;return Reflect.get(target,key);}});
    const muted=new Set<string>();
    muted.has=(key:string)=>{muteChecks++;return Set.prototype.has.call(muted,key);};
    assert.equal(graphDetails(graph,d,3,muted)?.paths,2);
    const initial={reads,muteChecks};
    for(let i=0;i<100;i++) {
        assert.equal(graphDetails(graph,d,3,muted)?.paths,2);
        assert.deepEqual(graphPath(graph,d,3,muted),[a,b,d]);
    }
    assert.deepEqual({reads,muteChecks},initial);
});

test('mute content, depth and graph replacement invalidate while old lookups remain stable', async () => {
    const graph=fixture(), muted=new Set<string>();
    const old=graphLookup(graph,3,muted);
    muted.add(b);
    assert.equal(graphDetails(graph,d,3,muted)?.paths,1);
    muted.add(c);
    assert.equal(graphDetails(graph,d,3,muted),null);
    muted.clear(); muted.add(a);
    assert.equal(graphDetails(graph,a,3,muted)?.hops,0);
    assert.equal(graphDetails(graph,d,3,muted)?.paths,2);
    assert.equal(graphDetails(graph,d,1,muted),null);
    assert.equal(graphDetails({...graph,follows:{[a]:[d]}},d,3)?.hops,1);
    assert.equal(old(d)?.paths,2);
    const results=await Promise.all(Array.from({length:20},async(_,i)=>graphDetails(graph,d,i%2?1:3)));
    results.forEach((result,i)=>assert.equal(result?.paths??null,i%2?null:2));
});

test('shortest counts ignore duplicates and cycles, include missing authors, and saturate safely', () => {
    const graph=fixture();
    assert.deepEqual(graphStats(graph),{nodes:5,people:4,authors:4,edges:6});
    assert.equal(graphDetails(graph,e,3),null);
    assert.equal(graphPath(graph,e,3),null);
    assert.equal(graphDetails(graph,d,3)?.paths,2);
    assert.deepEqual(graphPath(graph,a,0),[a]);
    assert.deepEqual(graphStats(null),{nodes:0,people:0,authors:0,edges:0});
    const follows:Record<string,string[]>={[a]:[key(10),key(11)]};
    for(let layer=0;layer<55;layer++) for(let side=0;side<2;side++) follows[key(10+layer*2+side)]=[key(12+layer*2),key(13+layer*2)];
    assert.equal(graphDetails({...graph,follows},key(120),60)?.paths,Number.MAX_SAFE_INTEGER);
});

test('dictionary decoding rejects invalid and non-string dictionary values', () => {
    const packed=packGraph(fixture());
    assert.equal(unpackGraph({...packed,keys:[...packed.keys,'invalid']}),null);
    assert.equal(unpackGraph({...packed,keys:packed.keys.map((k,i)=>i? k:123 as never)}),null);
    assert.equal(unpackGraph({...packed,follows:[[0,[0.5]]]}),null);
    assert.deepEqual(unpackGraph(packed)?.follows[a],[b,c]);
});

test('only the latest traversal is retained and scoring edits reuse its arrays', async () => {
    const { numericGraph, numericTraversal } = await import('../src/domain/wot/numeric.ts');
    const graph=fixture(), index=numericGraph(graph), muted=new Set([e,b]);
    assert.equal(numericGraph(graph),index);
    assert.ok(index.offsets instanceof Uint32Array);
    assert.ok(index.neighbors instanceof Uint32Array);
    const first=numericTraversal(index,3,muted);
    assert.ok(first.distances instanceof Int32Array);
    assert.ok(first.paths instanceof Float64Array);
    assert.equal(numericTraversal(index,3,new Set([b,e])),first);
    const scoring=structuredClone(WOT_SCORING);
    scoring.distanceWeights[2]=0.1;
    assert.equal(graphDetails(graph,d,3,muted,scoring)?.score,0.1);
    assert.equal(numericTraversal(index,3,muted),first);
    muted.delete(b);
    const unmuted=numericTraversal(index,3,muted);
    assert.notEqual(unmuted,first);
    const shallow=numericTraversal(index,1,muted);
    assert.notEqual(shallow,unmuted);
    assert.notEqual(numericTraversal(index,3,muted),unmuted);
    assert.notEqual(numericGraph({...graph}),index);
    assert.equal(first.paths[index.ids.get(d)!],1);
});

test('synthetic 100k-edge graph normalizes and traverses once for repeated queries', async t => {
    const { numericGraph, numericTraversal } = await import('../src/domain/wot/numeric.ts');
    const follows:Record<string,string[]>={};
    const size=10000;
    for(let i=0;i<size;i++) follows[key(i)]=Array.from({length:10},(_,j)=>key((i+j+1)%size));
    const graph:WotGraph={root:key(0),follows,relays:{},updatedAt:1,truncated:false};
    const started=performance.now();
    const index=numericGraph(graph), traversal=numericTraversal(index,4,new Set());
    const cold=performance.now()-started;
    const warm=performance.now();
    for(let i=0;i<1000;i++) {
        assert.equal(graphDetails(graph,key(40),4)?.hops,4);
        assert.equal(graphDetails(graph,key(41),4),null);
    }
    assert.equal(numericGraph(graph),index);
    assert.equal(numericTraversal(index,4,new Set()),traversal);
    assert.equal(index.neighbors.length,100000);
    t.diagnostic(`100k edges: cold ${cold.toFixed(2)}ms; 2000 cached queries ${(performance.now()-warm).toFixed(2)}ms (informational only)`);
});

test('compact snapshots preserve optional relay versions and full refresh timestamps', () => {
    const graph={...fixture(),relayVersions:{[b]:{createdAt:123,id:'relay-event'}},fullRefreshedAt:456};
    const decoded=unpackGraph(packGraph(graph));
    assert.deepEqual(decoded,{...graph,follows:{...graph.follows,[a]:[b,c]},listVersions:{}});
    assert.ok(!Object.hasOwn(unpackGraph(packGraph(fixture()))!,'relayVersions'));
    assert.ok(!Object.hasOwn(unpackGraph(packGraph(fixture()))!,'fullRefreshedAt'));
});
