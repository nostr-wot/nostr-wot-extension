import { MUTE_LIST_CACHE } from '@constants/relays.ts';
import { cacheKey, seedRelayCache, type CachedAnswer } from '@services/relays/relayCache.ts';
import type { MuteListRead } from '@domain/mutes/muteList.ts';
import { commitSnapshot } from './snapshots.ts';
import { readPublicListBatch, savePublicLists, type PublicLists } from './public-lists.ts';
import { createRelayPool } from '@services/relays/pool.ts';
import browser from '@lib/browser.ts';
import { liveQuery, isNewerReplaceable } from '@services/relays/relay.ts';
import { configuredRelayUrls, parseRelayList } from '@domain/relays/relayList.ts';
import { WOT_SYNC_BATCH_SIZE, WOT_MAX_SYNC_RELAYS, WOT_MAX_RELAYS_PER_AUTHOR, WOT_LIST_FRESH_MS, WOT_FULL_REFRESH_MS } from '@constants/wot.ts';
import type { WotGraph } from '@domain/wot/types.ts';
import type { NostrFilter } from '@domain/relays/types.ts';
import type { SignedEvent } from '@domain/nostr/types.ts';
import { reportWotProgress } from './progress.ts';
import { wotContext } from './state.ts';
let running: Promise<WotGraph> | null = null;
export function isWotSyncing(): boolean { return running !== null; }
/** Bounded snapshot refresh shared by manual and explicitly enabled automatic sync. */
export function syncWotGraph(options: { incremental?: boolean; accountId?: string } = {}): Promise<WotGraph> {
    if (running)
        return Promise.reject(new Error('WoT sync already running'));
    running = sync(options.incremental === true, options.accountId).then(async graph => {
        await reportWotProgress({ running: false, phase: 'complete' }, true);
        return graph;
    }, async error => {
        await reportWotProgress({ running: false, phase: error?.name === 'AbortError' || /WoT settings or account changed/.test(error?.message || '') ? 'cancelled' : 'failed', error: (error as Error).message }, true).catch(() => {});
        throw error;
    }).finally(() => { running = null; });
    return running;
}
async function sync(incremental: boolean, accountId?: string): Promise<WotGraph> {
    const { account, settings, signal, key, graph: previous } = await wotContext(true, accountId);
    await reportWotProgress({ accountId: account.id, phase: 'fetching', running: true, depth: 0, authors: 0, people: 0, lists: 0, depthCompleted: 0, depthTotal: 1, error: undefined, startedAt: Date.now() }, true);
    const stored = await browser.storage.sync.get('relays');
    const relays = configuredRelayUrls(stored.relays).slice(0, WOT_MAX_SYNC_RELAYS);
    if (!relays.length)
        throw new Error('Configure at least one relay');
    const graph: WotGraph = { root: account.pubkey, follows: {}, relays: {}, listVersions: {}, relayVersions: {}, fullRefreshedAt: incremental ? previous?.fullRefreshedAt : Date.now(), updatedAt: Date.now(), truncated: false };
    const maxFollows = settings.maxFollows ?? Infinity;
    const maxAuthors = settings.maxAuthors ?? Infinity;
    const maxEdges = settings.maxEdges ?? Infinity;
    let muteList: MuteListRead | null = null;
    const visited = new Set<string>();
    const people = new Set([account.pubkey]);
    let lists = 0;
    let frontier = new Set([account.pubkey]), edges = 0, reachable = false;
    const scope = [...relays].sort().join('|');
    const pool = createRelayPool();
    try {
    for (let depth = 0; depth < settings.maxHops && frontier.size; depth++) {
        const eligible = [...frontier].filter(pk => !visited.has(pk));
        const authors = eligible.slice(0, maxAuthors - visited.size);
        if (authors.length < eligible.length)
            graph.truncated = true;
        frontier = new Set();
        for (let i = 0; i < authors.length; i += WOT_SYNC_BATCH_SIZE) {
            signal.throwIfAborted();
            await reportWotProgress({ depth: depth + 1, authors: visited.size, depthCompleted: i, depthTotal: authors.length }, true);
            let exhausted = false, invalidMute = false;
            const batch = authors.slice(i, i + WOT_SYNC_BATCH_SIZE), allowed = new Set(batch), events = new Map<string, SignedEvent>();
            const records = new Map((await readPublicListBatch(batch)).map((record,index)=>[batch[index],record]));
            const full: string[] = [], requested = new Set<string>(), filters: NostrFilter[] = [];
            for (const pubkey of batch) {
                const record = records.get(pubkey);
                const fullDue = !incremental || pubkey === account.pubkey || !record || record.scope !== scope || Date.now() - record.fullCheckedAt >= WOT_FULL_REFRESH_MS;
                if (fullDue) { full.push(pubkey); requested.add(pubkey); }
                else if (Date.now() - record.checkedAt >= WOT_LIST_FRESH_MS) {
                    requested.add(pubkey);
                    // Overlap catches normal clock skew/delivery delays; a daily full
                    // refresh still discovers backdated lists outside this window.
                    filters.push({kinds:[3,10002],authors:[pubkey],since:Math.max(0,Math.floor((record.checkedAt-WOT_LIST_FRESH_MS)/1000)),limit:2});
                }
            }
            if (full.length) filters.unshift({kinds:[3,10002],authors:full,limit:full.length*2});
            if (batch.includes(account.pubkey)) filters.push({kinds:[10000],authors:[account.pubkey],limit:1});
            for await (const item of liveQuery(filters, filters.length ? relays : [], { closeOnExhaust: true, _createSocket: pool._createSocket, signal, skipLocalCache: true })) {
                signal.throwIfAborted();
                if (item.type === 'eose') { reachable = true; exhausted = true; }
                if (item.type !== 'event' && item.type !== 'update')
                    continue;
                const event = item.event;
                if (!allowed.has(event.pubkey) || ![3, 10002, 10000].includes(event.kind) || event.created_at > Date.now() / 1000 + 60) {
                    if (event.kind === 10000 && event.pubkey === account.pubkey) invalidMute = true;
                    continue;
                }
                if (item.type === 'update' || item.source === 'relay')
                    reachable = true;
                const id = event.pubkey + ':' + event.kind, previous = events.get(id);
                if (!previous || isNewerReplaceable(event, previous))
                    events.set(id, event);
                await reportWotProgress({ lists: lists + [...events.values()].filter(e => e.kind === 3).length });
            }
            const muteEvent = events.get(account.pubkey + ':10000');
            if (batch.includes(account.pubkey) && !invalidMute && (muteEvent || exhausted)) {
                const tags = muteEvent?.tags || [];
                const values = (name: string) => tags.filter(t => t[0] === name && typeof t[1] === 'string').map(t => t[1]);
                muteList = { people: values('p'), words: values('word'), hashtags: values('t'), events: values('e'), rawContent: muteEvent?.content || '', createdAt: muteEvent?.created_at || 0, reachable: true };
            }
            if (batch.includes(account.pubkey) && muteList) await updateMuteCache(account.pubkey,muteList);
            const saved: PublicLists[] = [];
            for (const pubkey of batch) {
                visited.add(pubkey);
                const cached = records.get(pubkey);
                const record: PublicLists = cached ? {...cached} : {pubkey,scope,checkedAt:0,fullCheckedAt:0};
                const candidate = events.get(pubkey + ':3');
                const versionKey = pubkey + ':3';
                const snapshotVersion = previous?.listVersions?.[versionKey];
                const cacheVersion = cached?.followVersion;
                const useCache = cacheVersion && (!snapshotVersion || cacheVersion.createdAt > snapshotVersion.createdAt || cacheVersion.createdAt === snapshotVersion.createdAt && cacheVersion.id <= snapshotVersion.id);
                const priorVersion = useCache ? cacheVersion : snapshotVersion;
                const priorFollows = useCache ? cached?.follows : previous?.follows[pubkey];
                const event = candidate && (!priorVersion || candidate.created_at > priorVersion.createdAt || candidate.created_at === priorVersion.createdAt && candidate.id <= priorVersion.id) ? candidate : undefined;
                if (event) graph.listVersions![versionKey] = { createdAt: event.created_at, id: event.id };
                else if (priorVersion) graph.listVersions![versionKey] = priorVersion;
                if (event || priorFollows) {
                    const follows = event ? [...new Set(event.tags.filter(t => t[0] === 'p' && /^[0-9a-f]{64}$/.test(t[1])).map(t => t[1]))] : priorFollows!;
                    record.follows = follows;
                    record.followVersion = event ? {createdAt:event.created_at,id:event.id} : priorVersion;
                    const room = Math.max(0, Math.min(maxFollows, maxEdges - edges));
                    graph.follows[pubkey] = follows.slice(0, room);
                    edges += graph.follows[pubkey].length;
                    lists++;
                    if (follows.length > room)
                        graph.truncated = true;
                    for (const follow of graph.follows[pubkey]) {
                        people.add(follow);
                        if (!visited.has(follow)) frontier.add(follow);
                    }
                }
                const relayCandidate = events.get(pubkey + ':10002');
                const snapshotRelayVersion = previous?.relayVersions?.[pubkey];
                const cacheRelayVersion = cached?.relayVersion;
                const useRelayCache = cacheRelayVersion && (!snapshotRelayVersion || cacheRelayVersion.createdAt > snapshotRelayVersion.createdAt || cacheRelayVersion.createdAt === snapshotRelayVersion.createdAt && cacheRelayVersion.id <= snapshotRelayVersion.id);
                const priorRelayVersion = useRelayCache ? cacheRelayVersion : snapshotRelayVersion;
                const relayEvent = relayCandidate && (!priorRelayVersion || relayCandidate.created_at > priorRelayVersion.createdAt || relayCandidate.created_at === priorRelayVersion.createdAt && relayCandidate.id <= priorRelayVersion.id) ? relayCandidate : undefined;
                const priorRelays = useRelayCache ? cached?.relays : previous?.relays[pubkey];
                if (relayEvent) {
                    const list = parseRelayList(relayEvent.tags);
                    graph.relays[pubkey] = list.relays.slice(0, WOT_MAX_RELAYS_PER_AUTHOR).map(url => ({ url, ...list.flags[url] }));
                    graph.relayVersions![pubkey] = {createdAt:relayEvent.created_at,id:relayEvent.id};
                } else if (priorRelays) {
                    graph.relays[pubkey] = priorRelays;
                    if (priorRelayVersion) graph.relayVersions![pubkey] = priorRelayVersion;
                }
                record.relays = graph.relays[pubkey];
                record.relayVersion = graph.relayVersions![pubkey];
                if (exhausted && requested.has(pubkey)) {
                    record.checkedAt = Date.now(); record.scope = scope;
                    if (full.includes(pubkey)) record.fullCheckedAt = record.checkedAt;
                }
                // Do not mark incomplete relay attempts as fresh.
                if ((requested.has(pubkey) || !cached) && (record.follows || record.relays || record.checkedAt)) saved.push(record);
            }
            await savePublicLists(saved, signal);
            await reportWotProgress({ authors: visited.size, people: people.size - 1, lists, depthCompleted: Math.min(i + batch.length, authors.length), depthTotal: authors.length }, true);
        }
        if (visited.size >= maxAuthors || edges >= maxEdges) {
            graph.truncated = true;
            break;
        }
    }
    graph.missingFollowLists = [...visited].filter(pubkey => graph.follows[pubkey] === undefined).length;
    if (!reachable)
        throw new Error('Could not reach relays; previous graph retained');
    signal.throwIfAborted();
    await commitSnapshot(key, graph, signal);
    return graph;
    } finally { pool.close(); }
}

async function updateMuteCache(pubkey: string, muteList: MuteListRead): Promise<void> {
    const muteKey = cacheKey(MUTE_LIST_CACHE,pubkey);
    const stored = await browser.storage.local.get(muteKey);
    const previous = (stored[muteKey] as CachedAnswer<MuteListRead> | undefined)?.value;
    if (!previous || muteList.createdAt > previous.createdAt) await seedRelayCache(MUTE_LIST_CACHE,pubkey,muteList);
}
