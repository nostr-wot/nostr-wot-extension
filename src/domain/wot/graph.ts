import { WOT_SCORING } from '@constants/wot.ts';
import type { WotDetails, WotGraph, WotScoring } from './types.ts';
import { numericGraph, numericTraversal } from './numeric.ts';
export function trustScore(hops: number, paths: number | null, scoring: WotScoring = WOT_SCORING): number {
    if (hops === 0)
        return 1;
    const key = Math.min(hops, 4) as 1 | 2 | 3 | 4;
    const bonus = hops > 1 && paths !== null ? Math.min(Math.max(0, paths - 1) * (scoring.pathBonus[key as 2 | 3 | 4] || 0), scoring.maxPathBonus) : 0;
    return Math.min(1, scoring.distanceWeights[key] + bonus);
}
/** Build the shortest-path index once for all targets in a query. */
export function graphLookup(graph: WotGraph, maxHops: number, muted: ReadonlySet<string> = new Set(), scoring: WotScoring = WOT_SCORING) {
    const index = numericGraph(graph);
    const { distances, paths } = numericTraversal(index, maxHops, muted);
    return (target: string): WotDetails | null => {
        const id = index.ids.get(target);
        if (id === undefined || distances[id] === -1) return null;
        const hops = distances[id];
        return { hops, paths: paths[id], score: trustScore(hops, paths[id], scoring) };
    };
}
export function graphDetails(graph: WotGraph, target: string, maxHops: number, muted: ReadonlySet<string> = new Set(), scoring: WotScoring = WOT_SCORING): WotDetails | null {
    return graphLookup(graph, maxHops, muted, scoring)(target);
}
export function graphPath(graph: WotGraph, target: string, maxHops: number, muted: ReadonlySet<string> = new Set()): string[] | null {
    const index = numericGraph(graph);
    const { distances, parents } = numericTraversal(index, maxHops, muted);
    let id = index.ids.get(target);
    if (id === undefined || distances[id] === -1) return null;
    const path = [target];
    while (id !== 0) {
        id = parents[id];
        path.push(index.keys[id]);
    }
    return path.reverse();
}

/** Count discovered identities as well as the lists used to discover them. */
export function graphStats(graph: WotGraph | null) {
    return graph ? { ...numericGraph(graph).stats } : { nodes: 0, people: 0, authors: 0, edges: 0 };
}
