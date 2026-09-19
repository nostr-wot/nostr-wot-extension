import { snapshotSummary } from '@services/wot/snapshots.ts';
import { getWotDatabases } from '@services/wot/databases.ts';
import { getWotProgress } from '@services/wot/progress.ts';
import { readWotMutes } from '@services/wot/mutes.ts';
import { WOT_DEFAULTS } from '@constants/wot.ts';
import type { WotSettings, WotState } from '@domain/wot/types.ts';
import { queryWot } from '@services/wot/queries.ts';
import { getWotSettings, saveWotSettings, wotIdentityContext, clearWotGraph } from '@services/wot/state.ts';
import { syncWotGraph, isWotSyncing } from '@services/wot/sync.ts';
import { isDomainAllowed, isIdentityDisabled } from './domain-handlers.ts';
import { handleGetPublicKey } from '@services/signing/signer.ts';
import type { HandlerFn } from './state.ts';
export async function getWotState(): Promise<WotState> {
    const settings = await getWotSettings();
    try {
        const { key, account } = await wotIdentityContext(false);
        const summary = await snapshotSummary(key);
        const progress = await getWotProgress();
        const mutes = settings.enabled ? await readWotMutes(account.id, account.pubkey) : null;
        return { settings, progress: progress?.accountId === account.id ? progress : null, muteStatus: mutes?.status, hasLocalGraph: !!summary, syncing: isWotSyncing(), updatedAt: summary?.updatedAt ?? null, nodes:summary?.nodes || 0,people:summary?.people || 0,authors:summary?.authors || 0,edges:summary?.edges || 0, missingFollowLists: summary?.missingFollowLists ?? 0, truncated: summary?.truncated ?? false };
    }
    catch {
        return { settings: settings || WOT_DEFAULTS, hasLocalGraph: false, syncing: isWotSyncing(), updatedAt: null, authors: 0, truncated: false };
    }
}
export const handlers = new Map<string, HandlerFn>([
    ['experimentalWot_getState', getWotState],
    ['experimentalWot_getTrustScore', params => queryWot('getTrustScore', params)],
    ['experimentalWot_getDatabases', getWotDatabases],
    ['experimentalWot_save', async (params) => { await saveWotSettings(params as Partial<WotSettings>); return getWotState(); }],
    ['experimentalWot_sync', async () => { await syncWotGraph(); return getWotState(); }],
    ['experimentalWot_clear', async () => { await clearWotGraph(); return getWotState(); }],
]);
export async function handleWotRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const origin = params.origin as string;
    const url = new URL(origin);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
        throw new Error('WoT requires HTTPS');
    // Availability reveals only the opt-in flag, never account or graph data.
    if (method === 'wot_isEnabled')
        return (await getWotSettings()).enabled;
    const ctx = await wotIdentityContext();
    if (!await isDomainAllowed(origin) || await isIdentityDisabled(origin))
        throw new Error('WoT requires a connected site with identity access');
    // Reuse the existing identity approval flow; global opt-in is not site consent.
    if (await handleGetPublicKey(origin) !== ctx.account.pubkey)
        throw new Error('Account changed');
    ctx.signal.throwIfAborted();
    const result = await queryWot(method.slice(4), params);
    ctx.signal.throwIfAborted();
    if (!await isDomainAllowed(origin) || await isIdentityDisabled(origin))
        throw new Error('Site access revoked');
    return result;
}
