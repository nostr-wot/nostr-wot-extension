import type { WotSyncProgress } from './types.ts';

/** Progress is per frontier: later hops have an unknown number of authors. */
export function wotHopPercent(progress?: WotSyncProgress | null): number {
    if (!progress?.depthTotal) return 0;
    return Math.min(100, Math.max(0, Math.floor((progress.depthCompleted ?? 0) / progress.depthTotal * 100)));
}

export function wotSyncStatus(hasGraph: boolean, incomplete: boolean, progress?: WotSyncProgress | null) {
    if (progress?.running) return { tone: 'syncing', label: 'wot.syncing' };
    if (progress && (progress.phase === 'failed' || progress.phase === 'cancelled'))
        return { tone: 'unreachable', label: 'wot.syncStopped' };
    if (!hasGraph) return { tone: 'blocked', label: 'wot.notSynced' };
    return incomplete ? { tone: 'blocked', label: 'wot.partial' } : { tone: 'synced', label: 'wot.syncComplete' };
}
