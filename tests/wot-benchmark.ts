import 'fake-indexeddb/auto';
/** Opt-in live benchmark; never part of CI. Uses in-memory browser storage. */
import WebSocket from 'ws';
import { WOT_SYNC_STATUS_KEY } from '../src/constants/wot.ts';
import browser from '../src/lib/browser.ts';
import { DEFAULT_RELAYS } from '../src/constants/relays.ts';
import { wotPubkey } from '../src/domain/wot/validation.ts';
import { saveWotSettings } from '../src/services/wot/state.ts';
import { syncWotGraph } from '../src/services/wot/sync.ts';
import { graphLookup, graphStats } from '../src/domain/wot/graph.ts';
import { packGraph, unpackGraph } from '../src/domain/wot/encoding.ts';
const pubkey = wotPubkey(process.argv[2] || 'npub19tv378w29hx4ljy7wgydreg9nu96czrs6clu8wkzr3af8z86rr7sujx4xe');
let lastProgress = 0;
browser.storage.onChanged.addListener(changes=>{
    const progress = changes[WOT_SYNC_STATUS_KEY]?.newValue as {running:boolean;depth:number;authors:number;people:number;lists:number}|undefined;
    if(progress && (Date.now()-lastProgress>15000 || !progress.running)) {
        lastProgress=Date.now();
        console.error(JSON.stringify({progress}));
    }
});
let connections = 0, frames = 0, wireBytes = 0, socketElapsedMs = 0;
class MeasuredSocket extends WebSocket {
    constructor(url: string) {
        super(url); connections++;
        const start = performance.now();
        this.on('message', data => { frames++; wireBytes += Buffer.byteLength(data as Buffer); });
        this.on('close', () => { socketElapsedMs += performance.now() - start; });
    }
}
globalThis.WebSocket = MeasuredSocket as unknown as typeof globalThis.WebSocket;
await browser.storage.local.set({accounts:[{id:'benchmark',pubkey,type:'npub',name:'Benchmark'}],activeAccountId:'benchmark'});
await browser.storage.sync.set({relays:DEFAULT_RELAYS.join(',')});
const depth = Number(process.argv[3] || 2);
if (![1,2,3].includes(depth)) throw new Error('Benchmark depth must be 1, 2 or 3');
const maxAuthors = process.env.WOT_BENCH_MAX_AUTHORS ? Number(process.env.WOT_BENCH_MAX_AUTHORS) : null;
for (let maxHops = 1; maxHops <= depth; maxHops++) {
    await saveWotSettings({enabled:true,maxHops,maxAuthors});
    const start = performance.now();
    const graph = await syncWotGraph();
    const syncMs = performance.now() - start;
    const encodeStart = performance.now(), packed = packGraph(graph), encodeMs = performance.now()-encodeStart;
    const decodeStart = performance.now(); unpackGraph(packed); const decodeMs = performance.now()-decodeStart;
    const targets = [...new Set(Object.values(graph.follows).flat())].slice(0,100);
    const queryStart = performance.now(), lookup = graphLookup(graph,maxHops);
    targets.forEach(lookup);
    const query100Ms = performance.now()-queryStart;
    const warmStart = performance.now();
    targets.forEach(graphLookup(graph,maxHops));
    const warmQuery100Ms = performance.now()-warmStart;
    console.log(JSON.stringify({maxHops,maxAuthors,syncMs,encodeMs,decodeMs,query100Ms,warmQuery100Ms,targets:targets.length,...graphStats(graph),missing:graph.missingFollowLists,truncated:graph.truncated,plainBytes:Buffer.byteLength(JSON.stringify(graph)),packedBytes:Buffer.byteLength(JSON.stringify(packed)),connections,frames,wireBytes,socketElapsedMs}));
}
// Shared relay cache expiry timers are intentionally not part of the benchmark.
process.exit(0);
