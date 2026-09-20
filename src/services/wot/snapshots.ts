import browser from '@lib/browser.ts';
import { WOT_GRAPH_PREFIX, WOT_INVENTORY_KEY } from '@constants/wot.ts';
import { packGraph, unpackGraph, type PackedWotGraph } from '@domain/wot/encoding.ts';
import { graphStats } from '@domain/wot/graph.ts';
import type { WotGraph } from '@domain/wot/types.ts';
import { databaseRead, databaseWrite, databaseKeys } from './database.ts';

export interface SnapshotSummary {
    format: 'wot-indexeddb';
    revision: string;
    root: string;
    updatedAt: number;
    truncated: boolean;
    missingFollowLists: number;
    nodes: number;
    people: number;
    authors: number;
    edges: number;
    bytes: number;
}
const migrations = new Map<string, Promise<SnapshotSummary>>();
let recovered: Promise<void> | undefined;
function recover(): Promise<void> { return recovered ??= collectOrphanSnapshots().catch(error=>{recovered=undefined;throw error;}); }
let mutations: Promise<unknown> = Promise.resolve();
function mutate<T>(action: () => Promise<T>): Promise<T> {
    const result = mutations.catch(()=>{}).then(action);
    mutations = result;
    return result;
}
let cached: {key: string; revision: string; value: Promise<WotGraph | null>} | undefined;
browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.accounts || changes.activeAccountId || changes.allowedDomains || cached && changes[cached.key])) cached = undefined;
});
function isSummary(value: unknown): value is SnapshotSummary {
    return !!value && typeof value === 'object' && (value as SnapshotSummary).format === 'wot-indexeddb';
}
/** Stage the large payload in IDB, then atomically replace only its small local pointer. */
export function commitSnapshot(key: string, graph: WotGraph, signal?: AbortSignal): Promise<SnapshotSummary> {
    return recover().then(()=>mutate(()=>commit(key,graph,signal)));
}
async function commit(key: string, graph: WotGraph, signal?: AbortSignal): Promise<SnapshotSummary> {
    signal?.throwIfAborted();
    const old = (await browser.storage.local.get(key))[key];
    const packed = packGraph(graph);
    const revision = crypto.randomUUID();
    const summary: SnapshotSummary = {format:'wot-indexeddb',revision,root:graph.root,updatedAt:graph.updatedAt,truncated:graph.truncated,missingFollowLists:graph.missingFollowLists || 0,...graphStats(graph),bytes:new TextEncoder().encode(JSON.stringify(packed)).byteLength};
    await databaseWrite('snapshots', [[revision, packed]], [], signal);
    try {
        signal?.throwIfAborted();
        const registry = (await browser.storage.local.get(WOT_INVENTORY_KEY))[WOT_INVENTORY_KEY] as string[] | undefined;
        signal?.throwIfAborted();
        await browser.storage.local.set({[key]:summary,[WOT_INVENTORY_KEY]:[...new Set([...(registry || []),key])]});
    } catch (error) {
        await databaseWrite('snapshots', [], [revision]).catch(() => {});
        throw error;
    }
    // Once the pointer is committed the completed account-scoped snapshot is valid,
    // even if an account switch arrives immediately after the storage notification.
    cached = {key,revision,value:Promise.resolve(graph)};
    if (isSummary(old)) await databaseWrite('snapshots', [], [old.revision]).catch(() => {});
    return summary;
}
export async function readSnapshot(key: string): Promise<WotGraph | null> {
    await recover();
    const stored = (await browser.storage.local.get(key))[key];
    if (!stored) return null;
    if (!isSummary(stored)) {
        const graph = unpackGraph(stored as WotGraph);
        if (!graph) return null;
        await migrate(key,graph);
        return readSnapshot(key);
    }
    if (cached?.key === key && cached.revision === stored.revision) return cached.value;
    const value = databaseRead<PackedWotGraph>('snapshots',stored.revision).then(data => {
        if (!data) throw new Error('WoT snapshot is unavailable; resync to restore it');
        const graph = unpackGraph(data);
        if (!graph || graph.root !== stored.root) throw new Error('Invalid WoT snapshot; resync to restore it');
        return graph;
    });
    const entry = {key,revision:stored.revision,value};
    cached = entry;
    void value.catch(() => { if (cached === entry) cached = undefined; });
    return value;
}
export async function snapshotSummary(key: string): Promise<SnapshotSummary | null> {
    const stored = (await browser.storage.local.get(key))[key];
    if (!stored) return null;
    if (isSummary(stored)) return stored;
    // One-time migration of pre-IDB development snapshots.
    const graph = unpackGraph(stored as WotGraph);
    return graph ? migrate(key,graph) : null;
}
function migrate(key: string, graph: WotGraph): Promise<SnapshotSummary> {
    let pending = migrations.get(key);
    if (!pending) {
        pending = commitSnapshot(key,graph).finally(()=>migrations.delete(key));
        migrations.set(key,pending);
    }
    return pending;
}
export function removeSnapshot(key: string): Promise<void> {
    return mutate(()=>remove(key));
}
async function remove(key: string): Promise<void> {
    const stored = (await browser.storage.local.get(key))[key];
    const registry = (await browser.storage.local.get(WOT_INVENTORY_KEY))[WOT_INVENTORY_KEY] as string[] | undefined;
    await browser.storage.local.remove(key);
    await browser.storage.local.set({[WOT_INVENTORY_KEY]:(registry || []).filter(k=>k!==key)});
    if (cached?.key === key) cached = undefined;
    if (isSummary(stored)) await databaseWrite('snapshots',[],[stored.revision]);
}
export async function snapshotKeys(accountIds: string[]): Promise<string[]> {
    const registry = (await browser.storage.local.get(WOT_INVENTORY_KEY))[WOT_INVENTORY_KEY] as string[] | undefined;
    return [...new Set([...(registry || []).filter(k=>typeof k==='string' && k.startsWith(WOT_GRAPH_PREFIX)),...accountIds.map(id=>WOT_GRAPH_PREFIX+id)])];
}

/** Remove abandoned staging generations after a worker crash, preserving committed pointers. */
export function collectOrphanSnapshots(): Promise<void> {
    return mutate(async()=>{
        const stored=await browser.storage.local.get(['accounts',WOT_INVENTORY_KEY]);
        const accounts=(stored.accounts || []) as Array<{id:string}>;
        const keys=await snapshotKeys(accounts.map(account=>account.id));
        const pointers=await browser.storage.local.get(keys);
        const live=new Set(Object.values(pointers).filter(isSummary).map(summary=>summary.revision));
        const obsolete=(await databaseKeys('snapshots')).filter(key=>!live.has(key));
        if(obsolete.length) await databaseWrite('snapshots',[],obsolete);
    });
}
