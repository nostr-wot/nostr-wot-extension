import type { WotGraph } from './types.ts';

/** Storage-only dictionary encoding. Public APIs continue to use Nostr public keys. */
export interface PackedWotGraph {
    format: 1;
    keys: string[];
    root: number;
    follows: [number, number[]][];
    relays: [number, WotGraph['relays'][string]][];
    versions: [number, number, string][];
    updatedAt: number;
    truncated: boolean;
    missingFollowLists?: number;
    relayVersions?: [number, number, string][];
    fullRefreshedAt?: number;
}
export function packGraph(graph: WotGraph): PackedWotGraph {
    const keys: string[] = [], ids = new Map<string, number>();
    const id = (key: string) => {
        let value = ids.get(key);
        if (value === undefined) { value = keys.length; keys.push(key); ids.set(key, value); }
        return value;
    };
    return {
        format: 1, keys, root: id(graph.root),
        follows: Object.entries(graph.follows).map(([key, follows]) => [id(key), [...new Set(follows)].map(id)]),
        relays: Object.entries(graph.relays).map(([key, relays]) => [id(key), relays]),
        versions: Object.entries(graph.listVersions || {}).map(([key, version]) => [id(key.slice(0, -2)), version.createdAt, version.id]),
        ...(graph.relayVersions === undefined ? {} : { relayVersions: Object.entries(graph.relayVersions).map(([key, version]): [number, number, string] => [id(key), version.createdAt, version.id]) }),
        ...(graph.fullRefreshedAt === undefined ? {} : { fullRefreshedAt: graph.fullRefreshedAt }),
        updatedAt: graph.updatedAt, truncated: graph.truncated,
        ...(graph.missingFollowLists === undefined ? {} : { missingFollowLists: graph.missingFollowLists }),
    };
}
/** Accept earlier development snapshots; the next successful sync writes compact form. */
export function unpackGraph(value: WotGraph | PackedWotGraph | null | undefined): WotGraph | null {
    if (!value) return null;
    if (!('format' in value)) return value.root && value.follows ? value : null;
    if (value.format !== 1 || !Array.isArray(value.keys)) return null;
    try {
        // Validate each dictionary entry once rather than once for every edge.
        for (const entry of value.keys)
            if (typeof entry !== 'string' || !/^[0-9a-f]{64}$/.test(entry)) return null;
        const key = (id: number) => {
            if (!Number.isInteger(id) || id < 0 || id >= value.keys.length) throw new Error('Invalid graph reference');
            return value.keys[id];
        };
        return {
            root: key(value.root),
            follows: Object.fromEntries(value.follows.map(([id, follows]) => [key(id), follows.map(key)])),
            relays: Object.fromEntries(value.relays.map(([id, relays]) => [key(id), relays])),
            listVersions: Object.fromEntries(value.versions.map(([id, createdAt, eventId]) => [key(id) + ':3', { createdAt, id: eventId }])),
            ...(value.relayVersions === undefined ? {} : { relayVersions: Object.fromEntries(value.relayVersions.map(([id, createdAt, eventId]) => [key(id), { createdAt, id: eventId }])) }),
            ...(value.fullRefreshedAt === undefined ? {} : { fullRefreshedAt: value.fullRefreshedAt }),
            updatedAt: value.updatedAt, truncated: value.truncated,
            ...(value.missingFollowLists === undefined ? {} : { missingFollowLists: value.missingFollowLists }),
        };
    } catch { return null; }
}
