import type { WotGraph } from './types.ts';

interface Traversal {
    maxHops: number;
    muteSignature: string;
    distances: Int32Array;
    paths: Float64Array;
    parents: Int32Array;
}
interface NumericGraph {
    keys: string[];
    ids: Map<string, number>;
    offsets: Uint32Array;
    neighbors: Uint32Array;
    stats: { nodes: number; people: number; authors: number; edges: number };
    traversal?: Traversal;
}
// Graph snapshots are immutable: replacing a snapshot releases both indexes once
// its callers finish. Keep only the most recent depth/mute traversal per graph.
const indexes = new WeakMap<WotGraph, NumericGraph>();

export function numericGraph(graph: WotGraph): NumericGraph {
    const cached = indexes.get(graph);
    if (cached) return cached;
    const keys = [graph.root], ids = new Map([[graph.root, 0]]);
    const id = (key: string) => {
        let result = ids.get(key);
        if (result === undefined) { result = keys.length; keys.push(key); ids.set(key, result); }
        return result;
    };
    const rows = new Map<number, Uint32Array>();
    let edges = 0, uniqueEdges = 0;
    for (const [author, follows] of Object.entries(graph.follows)) {
        const authorId = id(author);
        const row = Uint32Array.from(new Set(follows), id);
        rows.set(authorId, row);
        edges += follows.length;
        uniqueEdges += row.length;
    }
    const offsets = new Uint32Array(keys.length + 1), neighbors = new Uint32Array(uniqueEdges);
    let offset = 0;
    for (let i = 0; i < keys.length; i++) {
        offsets[i] = offset;
        const row = rows.get(i);
        if (row) { neighbors.set(row, offset); offset += row.length; }
    }
    offsets[keys.length] = offset;
    const result = { keys, ids, offsets, neighbors,
        stats: { nodes: keys.length, people: keys.length - 1, authors: rows.size, edges } };
    indexes.set(graph, result);
    return result;
}

/** The cache stores counts, not scores, so scoring edits never require a BFS. */
export function numericTraversal(graph: NumericGraph, maxHops: number, muted: ReadonlySet<string>): Traversal {
    // Compare content, including changes to a Set reused by its caller.
    const muteSignature = JSON.stringify([...muted].sort());
    if (graph.traversal?.maxHops === maxHops && graph.traversal.muteSignature === muteSignature)
        return graph.traversal;
    const count = graph.keys.length;
    const distances = new Int32Array(count).fill(-1), parents = new Int32Array(count).fill(-1);
    const paths = new Float64Array(count), queue = new Uint32Array(count), blocked = new Uint8Array(count);
    for (const key of muted) {
        const id = graph.ids.get(key);
        if (id !== undefined) blocked[id] = 1;
    }
    distances[0] = 0; paths[0] = 1;
    let length = 1;
    for (let i = 0; i < length; i++) {
        const from = queue[i], depth = distances[from];
        if (depth >= maxHops) continue;
        for (let edge = graph.offsets[from]; edge < graph.offsets[from + 1]; edge++) {
            const to = graph.neighbors[edge];
            if (blocked[to]) continue;
            if (distances[to] === -1) {
                distances[to] = depth + 1;
                parents[to] = from;
                queue[length++] = to;
            }
            if (distances[to] === depth + 1)
                paths[to] = Math.min(Number.MAX_SAFE_INTEGER, paths[to] + paths[from]);
        }
    }
    return graph.traversal = { maxHops, muteSignature, distances, paths, parents };
}
