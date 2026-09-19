import { readSnapshot, removeSnapshot } from './snapshots.ts';
import browser from '@lib/browser.ts';
import { WOT_DEFAULTS, WOT_SETTINGS_KEY, WOT_GRAPH_PREFIX } from '@constants/wot.ts';
import { validateWotSettings } from '@domain/wot/validation.ts';
import type { WotSettings } from '@domain/wot/types.ts';
import type { Account } from '@domain/accounts/account.ts';
let generation = new AbortController();
export function invalidateWot(): void { generation.abort(new Error('WoT settings or account changed')); generation = new AbortController(); }
browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[WOT_SETTINGS_KEY] || changes.activeAccountId || changes.accounts || changes.allowedDomains || changes.identityDisabledSites))
        invalidateWot();
});
export async function getWotSettings(): Promise<WotSettings> {
    const stored = await browser.storage.local.get(WOT_SETTINGS_KEY);
    try {
        return validateWotSettings((stored[WOT_SETTINGS_KEY] || {}) as Partial<WotSettings>);
    }
    catch {
        return { ...WOT_DEFAULTS };
    }
}
export async function saveWotSettings(input: Partial<WotSettings>): Promise<WotSettings> {
    const settings = validateWotSettings(input);
    invalidateWot();
    await browser.storage.local.set({ [WOT_SETTINGS_KEY]: settings });
    return settings;
}
/** Permission and identity checks must not deserialize a potentially large graph. */
export async function wotIdentityContext(requireEnabled = true) {
    const signal = generation.signal;
    const settings = await getWotSettings();
    if (requireEnabled && !settings.enabled)
        throw new Error('Experimental WoT is disabled');
    const stored = await browser.storage.local.get(['accounts', 'activeAccountId']);
    const account = (stored.accounts as Account[] | undefined)?.find(a => a.id === stored.activeAccountId);
    signal.throwIfAborted();
    if (!account)
        throw new Error('No active account');
    const key = WOT_GRAPH_PREFIX + account.id;
    return { account, settings, key, signal };
}
export async function wotContext(requireEnabled = true) {
    const context = await wotIdentityContext(requireEnabled);
    const { account, key, signal } = context;
    const snapshot = await readSnapshot(key);
    const graph = snapshot?.root === account.pubkey ? snapshot : null;
    signal.throwIfAborted();
    return { ...context, graph };
}
export async function clearWotGraph(): Promise<void> {
    const { key } = await wotIdentityContext(false);
    invalidateWot();
    await removeSnapshot(key);
}
