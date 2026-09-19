import { WOT_CACHE_MS, WOT_ORACLE_TIMEOUT_MS, WOT_QUERY_TIMEOUT_MS, WOT_ORACLE_CONCURRENCY, WOT_MAX_CACHE_ENTRIES } from '@constants/wot.ts';
import { readWotMutes } from './mutes.ts';
import { graphLookup, graphPath, graphStats, trustScore } from '@domain/wot/graph.ts';
import { wotPubkey, wotTargets } from '@domain/wot/validation.ts';
import { WotOracle } from './oracle.ts';
import { wotContext, wotIdentityContext } from './state.ts';
const cache = new Map<string, {
    at: number;
    value: unknown;
}>();
const pending = new Map<string, Promise<unknown>>();
/** Queries never trigger local graph sync. Hybrid uses the oracle only on local misses. */
export async function queryWot(method: string, params: Record<string, unknown>): Promise<unknown> {
    const ctx = await wotContext();
    const { account, settings, graph, signal: contextSignal } = ctx;
    const signal = AbortSignal.any([contextSignal, AbortSignal.timeout(WOT_QUERY_TIMEOUT_MS)]);
    const mutes = await readWotMutes(account.id, account.pubkey);
    const muted = mutes.people;
    const oracle = new WotOracle(settings.oracleUrl, signal);
    const hops = params.maxHops === undefined ? settings.maxHops : params.maxHops;
    if (!Number.isInteger(hops) || (hops as number) < 0 || (hops as number) > settings.maxHops)
        throw new Error('Invalid maxHops');
    const maxHops = hops as number;
    const local = settings.mode !== 'remote';
    const remote = settings.mode !== 'local';
    async function memo<T>(method: string, target: string, load: () => Promise<T>): Promise<T> {
        signal.throwIfAborted();
        const key = JSON.stringify([account.id, account.pubkey, settings.oracleUrl, method, target]);
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < WOT_CACHE_MS)
            return hit.value as T;
        let work = pending.get(key);
        if (!work) {
            work = load().then(value => { signal.throwIfAborted(); if (cache.size >= WOT_MAX_CACHE_ENTRIES)
                cache.delete(cache.keys().next().value!); cache.set(key, { at: Date.now(), value }); return value; }).finally(() => { pending.delete(key); });
            pending.set(key, work);
        }
        const value = await work;
        signal.throwIfAborted();
        return value as T;
    }
    let lookup: ReturnType<typeof graphLookup> | undefined;
    async function details(target: string) {
        if (muted.has(target)) return null;
        const found = local && graph ? (lookup ??= graphLookup(graph, maxHops, muted, settings.scoring))(target) : null;
        if (found)
            return found;
        if (remote) {
            // Aggregate oracle counts cannot prove that paths avoid muted accounts.
            // Credit only the concrete clean path when local exclusions exist.
            if (muted.size) {
                const path = await memo('path', target, () => oracle.path(account.pubkey, target));
                return path && path.length <= maxHops + 1 && !path.some(pk => muted.has(pk))
                    ? { hops: path.length - 1, paths: 1, score: trustScore(path.length - 1, 1, settings.scoring) } : null;
            }
            const value = await memo('details', target, () => oracle.details(account.pubkey, target));
            return value && value.hops <= maxHops ? { ...value, score: trustScore(value.hops, value.paths, settings.scoring) } : null;
        }
        if (!graph)
            throw new Error('Sync the local WoT graph from the experimental menu first');
        return null;
    }
    async function follows(pubkey: string) {
        if (local && graph?.follows[pubkey] !== undefined)
            return graph.follows[pubkey];
        if (remote)
            return memo('follows', pubkey, () => oracle.follows(pubkey));
        if (!graph)
            throw new Error('Sync the local WoT graph from the experimental menu first');
        return [];
    }
    let result: unknown;
    switch (method) {
        case 'getStatus':
            result = { configured: true, mode: settings.mode, hasLocalGraph: !!graph, updatedAt: graph?.updatedAt ?? null, truncated: graph?.truncated ?? false, muteStatus: mutes.status };
            break;
        case 'getConfig':
            result = { maxHops: settings.maxHops, timeout: WOT_ORACLE_TIMEOUT_MS, scoring: settings.scoring };
            break;
        case 'getDetails':
            result = await details(wotPubkey(params.target));
            break;
        case 'getDistance':
            result = (await details(wotPubkey(params.target)))?.hops ?? null;
            break;
        case 'getTrustScore':
            result = muted.has(wotPubkey(params.target)) ? 0 : (await details(wotPubkey(params.target)))?.score ?? null;
            break;
        case 'isInMyWoT':
            result = !!await details(wotPubkey(params.target));
            break;
        case 'getFollows':
            result = await follows(params.pubkey === undefined ? account.pubkey : wotPubkey(params.pubkey));
            break;
        case 'getCommonFollows': {
            const target = wotPubkey(params.pubkey);
            if (settings.mode === 'remote')
                result = await memo('common', target, () => oracle.common(account.pubkey, target));
            else {
                const [own, other] = await Promise.all([follows(account.pubkey), follows(target)]);
                const set = new Set(other);
                result = own.filter(pk => set.has(pk));
            }
            break;
        }
        case 'getPath': {
            const target = wotPubkey(params.target);
            if (muted.has(target)) { result = null; break; }
            const path = local && graph ? graphPath(graph, target, maxHops, muted) : null;
            const remotePath = !path && remote ? await memo('path', target, () => oracle.path(account.pubkey, target)) : null;
            result = path || (remotePath && remotePath.length <= maxHops + 1 && !remotePath.some(pk => muted.has(pk)) ? remotePath : null);
            break;
        }
        case 'getDistanceBatch':
        case 'getTrustScoreBatch':
        case 'filterByWoT': {
            const targets = wotTargets(method === 'filterByWoT' ? params.pubkeys : params.targets);
            const values: Record<string, unknown> = {};
            for (let i = 0; i < targets.length; i += WOT_ORACLE_CONCURRENCY)
                await Promise.all(targets.slice(i, i + WOT_ORACLE_CONCURRENCY).map(async (target) => {
                    const info = await details(target);
                    values[target] = method === 'getTrustScoreBatch' ? muted.has(target) ? 0 : info?.score ?? null : !info ? null : params.includePaths || params.includeScores ? { hops: info.hops, ...(params.includePaths ? { paths: info.paths } : {}), ...(params.includeScores ? { score: info.score } : {}) } : info.hops;
                }));
            result = method === 'filterByWoT' ? targets.filter(t => values[t] !== null) : values;
            break;
        }
        case 'getRelayList':
            result = graph?.relays[wotPubkey(params.pubkey)] ?? null;
            break;
        case 'getRelayPool': {
            const pool = new Map<string, number>();
            for (const list of Object.values(graph?.relays || {}))
                for (const { url } of list)
                    pool.set(url, (pool.get(url) || 0) + 1);
            result = [...pool].map(([url, endorsements]) => ({ url, endorsements })).sort((a, b) => b.endorsements - a.endorsements);
            break;
        }
        case 'getStats':
            result = settings.mode === 'remote' ? await memo('stats', '', () => oracle.stats()) : { ...graphStats(graph), missingFollowLists: graph?.missingFollowLists ?? 0, updatedAt: graph?.updatedAt ?? null, truncated: graph?.truncated ?? false };
            break;
        default: throw new Error('Unknown WoT method');
    }
    signal.throwIfAborted();
    const current = await wotIdentityContext();
    const currentMutes = await readWotMutes(account.id, account.pubkey);
    if (currentMutes.revision !== mutes.revision || currentMutes.status !== mutes.status)
        throw new Error('Mute list changed; retry the query');
    if (current.account.id !== account.id || current.account.pubkey !== account.pubkey || JSON.stringify(current.settings) !== JSON.stringify(settings))
        throw new Error('WoT settings or account changed');
    signal.throwIfAborted();
    return result;
}
