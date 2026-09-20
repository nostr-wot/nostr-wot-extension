import browser from '@lib/browser.ts';
import { WOT_PROGRESS_INTERVAL_MS, WOT_SYNC_STATUS_KEY } from '@constants/wot.ts';
import type { WotSyncProgress } from '@domain/wot/types.ts';
let current: WotSyncProgress | null = null;
let lastPublished = 0;
export async function getWotProgress(): Promise<WotSyncProgress | null> {
    if (current) return current;
    const stored = (await browser.storage.local.get(WOT_SYNC_STATUS_KEY))[WOT_SYNC_STATUS_KEY] as WotSyncProgress | undefined;
    if (!stored?.accountId) return null;
    return stored.running ? { ...stored, running: false, phase: 'cancelled', error: 'Previous sync was interrupted; resync to retry' } : stored;
}
/** Throttle cross-context notifications, keeping current counters in worker memory. */
export async function reportWotProgress(update: Partial<WotSyncProgress>, force = false): Promise<void> {
    const now = Date.now();
    current = { accountId: '', phase: 'fetching', running: true, depth: 0, authors: 0, people: 0, lists: 0, startedAt: now, ...current, ...update, updatedAt: now };
    if (!force && now - lastPublished < WOT_PROGRESS_INTERVAL_MS) return;
    lastPublished = now;
    await browser.storage.local.set({ [WOT_SYNC_STATUS_KEY]: current });
}
