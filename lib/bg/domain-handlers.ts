/**
 * Domain, badge, tab, and injection handlers.
 * @module lib/bg/domain-handlers
 */

import browser from '../browser.ts';
import { getDomainFromUrl } from '@shared/url.ts';
import { isRestrictedUrl, type HandlerFn, type LocalAccountEntry } from './state.ts';

// ── Domain permission functions (with in-memory cache) ──

let _cachedDomains: string[] | null = null;
let _cachedDismissedDomains: string[] | null = null;
let _cachedAccountReadOnly: { accountId: string | undefined; readOnly: boolean } | null = null;

function invalidateDomainCache(): void { _cachedDomains = null; }
function invalidateDismissedCache(): void { _cachedDismissedDomains = null; }
function invalidateAccountCache(): void { _cachedAccountReadOnly = null; }

// Invalidate caches on external storage changes
try {
    browser.storage.onChanged.addListener((changes: Record<string, unknown>, area: string) => {
        if (area === 'local') {
            if ((changes as Record<string, unknown>).allowedDomains) invalidateDomainCache();
            if ((changes as Record<string, unknown>).dismissedDomains) invalidateDismissedCache();
            if ((changes as Record<string, unknown>).accounts || (changes as Record<string, unknown>).activeAccountId) invalidateAccountCache();
        }
    });
} catch { /* storage.onChanged may not be available in tests */ }

export async function getAllowedDomains(): Promise<string[]> {
    if (_cachedDomains !== null) return _cachedDomains;
    const data = await browser.storage.local.get('allowedDomains');
    _cachedDomains = (data as Record<string, string[]>).allowedDomains || [];
    return _cachedDomains;
}

export async function isDomainAllowed(domain: string): Promise<boolean> {
    const domains = await getAllowedDomains();
    return domains.includes(domain);
}

export async function addAllowedDomain(domain: string): Promise<boolean> {
    const domains = await getAllowedDomains();
    if (!domains.includes(domain)) {
        domains.push(domain);
        await browser.storage.local.set({ allowedDomains: domains });
        invalidateDomainCache();
    }
    // Clear dismissal so manual adds via GlobeButton reset the state
    await removeDismissedDomain(domain);
    return true;
}

export async function removeAllowedDomain(domain: string): Promise<boolean> {
    const domains = await getAllowedDomains();
    const filtered = domains.filter(d => d !== domain);
    await browser.storage.local.set({ allowedDomains: filtered });
    invalidateDomainCache();
    return true;
}

// ── Dismissed domains (denied connect prompts) ──

export async function getDismissedDomains(): Promise<string[]> {
    if (_cachedDismissedDomains !== null) return _cachedDismissedDomains;
    const data = await browser.storage.local.get('dismissedDomains');
    _cachedDismissedDomains = (data as Record<string, string[]>).dismissedDomains || [];
    return _cachedDismissedDomains;
}

export async function isDomainDismissed(domain: string): Promise<boolean> {
    const domains = await getDismissedDomains();
    return domains.includes(domain);
}

export async function addDismissedDomain(domain: string): Promise<boolean> {
    const domains = await getDismissedDomains();
    if (!domains.includes(domain)) {
        domains.push(domain);
        await browser.storage.local.set({ dismissedDomains: domains });
        invalidateDismissedCache();
    }
    return true;
}

async function removeDismissedDomain(domain: string): Promise<void> {
    const domains = await getDismissedDomains();
    if (domains.includes(domain)) {
        const filtered = domains.filter(d => d !== domain);
        await browser.storage.local.set({ dismissedDomains: filtered });
        invalidateDismissedCache();
    }
}

// ── Wait for domain to be connected ──

const CONNECT_WAIT_TIMEOUT_MS = 120_000; // 2 minutes

/**
 * Wait for a domain to appear in allowedDomains.
 * Resolves true when the domain is added, false on timeout.
 * Used after opening the popup so the user can click the Connect button.
 */
export function waitForDomainAllowed(domain: string): Promise<boolean> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            browser.storage.onChanged.removeListener(listener);
            resolve(false);
        }, CONNECT_WAIT_TIMEOUT_MS);

        function listener(changes: Record<string, unknown>, area: string) {
            if (area === 'local' && (changes as Record<string, unknown>).allowedDomains) {
                // Check if the domain is now allowed
                isDomainAllowed(domain).then((allowed) => {
                    if (allowed) {
                        clearTimeout(timer);
                        browser.storage.onChanged.removeListener(listener);
                        resolve(true);
                    }
                });
            }
        }

        browser.storage.onChanged.addListener(listener);
    });
}

// ── Host permissions ──

export async function hasHostPermission(): Promise<boolean> {
    return browser.permissions.contains({ origins: ['<all_urls>'] });
}

export async function requestHostPermission(): Promise<boolean> {
    return browser.permissions.request({ origins: ['<all_urls>'] });
}

// ── Tab broadcast / refresh ──

export async function broadcastAccountChanged(pubkey: string): Promise<void> {
    try {
        const tabs = await browser.tabs.query({});
        for (const tab of tabs) {
            if (isRestrictedUrl(tab.url)) continue;
            browser.tabs.sendMessage(tab.id!, { type: 'NOSTR_ACCOUNT_CHANGED', pubkey }).catch(() => {});
        }
    } catch (e: unknown) {
        console.warn('[BG] broadcastAccountChanged failed:', (e as Error).message);
    }
}

/**
 * Formerly re-injected/refreshed trust badges across open tabs. The badge
 * subsystem has been removed, so this is now a no-op. It is retained because
 * several account-switching / config-update handlers still call it.
 */
export async function refreshBadgesOnAllTabs(): Promise<void> {
    /* badge subsystem removed — no-op */
}

// ── Read-only guard ──

export async function isActiveAccountReadOnly(): Promise<boolean> {
    const data = await browser.storage.local.get(['accounts', 'activeAccountId']) as Record<string, unknown>;
    const activeId = data.activeAccountId as string | undefined;
    if (_cachedAccountReadOnly && _cachedAccountReadOnly.accountId === activeId) {
        return _cachedAccountReadOnly.readOnly;
    }
    const acct = ((data.accounts as LocalAccountEntry[]) || []).find(a => a.id === activeId);
    const readOnly = !!(acct?.readOnly || acct?.type === 'npub');
    _cachedAccountReadOnly = { accountId: activeId, readOnly };
    return readOnly;
}

// ── Identity disable ──

export async function isIdentityDisabled(domain: string): Promise<boolean> {
    const data = await browser.storage.local.get('identityDisabledSites') as Record<string, string[]>;
    return (data.identityDisabledSites || []).includes(domain);
}

async function setIdentityDisabled(domain: string, disabled: boolean): Promise<boolean> {
    const data = await browser.storage.local.get('identityDisabledSites') as Record<string, string[]>;
    const sites = new Set(data.identityDisabledSites || []);
    if (disabled) sites.add(domain);
    else sites.delete(domain);
    await browser.storage.local.set({ identityDisabledSites: [...sites] });
    return true;
}

// ── Enable for current domain ──

async function enableForCurrentDomain(): Promise<{ ok: boolean; domain?: string; error: string | null }> {
    try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url) {
            return { ok: false, error: 'No active tab' };
        }

        const domain = getDomainFromUrl(tab.url);
        if (!domain) {
            return { ok: false, error: 'Could not get domain from URL' };
        }

        if (isRestrictedUrl(tab.url)) {
            return { ok: false, error: 'Cannot enable on this page' };
        }

        await addAllowedDomain(domain);
        const injected = await injectIntoTab(tab.id!, tab.url);

        return { ok: injected, domain, error: injected ? null : 'Injection failed' };
    } catch (e: unknown) {
        return { ok: false, error: (e as Error).message };
    }
}

// ── Tab injection ──

/**
 * Formerly injected the trust-badge CSS + engine into an allowed tab. The badge
 * subsystem has been removed, so injection is a no-op. The function is kept (and
 * still returns a success boolean) because tab listeners and
 * `enableForCurrentDomain` call it; the page's own content scripts (NIP-07
 * provider, etc.) are still injected via the manifest content_scripts.
 */
export async function injectIntoTab(_tabId: number, url: string): Promise<boolean> {
    if (isRestrictedUrl(url)) {
        return false;
    }
    return true;
}

// ── Host access request (Chrome 133+) ──

export async function requestHostAccessIfNeeded(tabId: number, url: string): Promise<void> {
    if (isRestrictedUrl(url)) {
        return;
    }
    const hasAllSites = await hasHostPermission();
    if (hasAllSites) return;

    if ((browser.permissions as unknown as Record<string, unknown>)?.addHostAccessRequest) {
        try {
            await (browser.permissions as unknown as Record<string, (opts: { tabId: number }) => Promise<void>>).addHostAccessRequest({ tabId });
        } catch {
            // Not supported or tab closed — ignore
        }
    }
}

// ── Nostr pubkey from active tab ──

async function getNostrPubkeyFromActiveTab(): Promise<string | null> {
    try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return null;

        const results = await browser.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: async () => {
                try {
                    if ((window as unknown as Record<string, unknown>).nostr && typeof ((window as unknown as Record<string, unknown>).nostr as Record<string, unknown>).getPublicKey === 'function') {
                        return await (((window as unknown as Record<string, unknown>).nostr as Record<string, unknown>).getPublicKey as () => Promise<string>)();
                    }
                } catch {
                    return null;
                }
                return null;
            }
        });

        return results?.[0]?.result || null;
    } catch {
        return null;
    }
}

async function injectWotApi(): Promise<{ ok: boolean; url?: string; error?: string }> {
    try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: 'No active tab' };

        if (isRestrictedUrl(tab.url)) {
            return { ok: false, error: 'Cannot inject on this page' };
        }

        return { ok: true, url: tab.url };
    } catch (e: unknown) {
        return { ok: false, error: (e as Error).message };
    }
}

// ── Tab listeners setup (called from background.ts) ──

export function setupTabListeners(): void {
    browser.tabs.onUpdated.addListener(async (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
        if (changeInfo.status !== 'complete') return;
        if (!tab.url) return;

        const domain = getDomainFromUrl(tab.url);
        if (domain && await isDomainAllowed(domain)) {
            await injectIntoTab(tabId, tab.url);
        }
    });

    browser.tabs.onCreated.addListener(async (tab: chrome.tabs.Tab) => {
        if (!tab.url || tab.status !== 'complete') return;

        const domain = getDomainFromUrl(tab.url);
        if (domain && await isDomainAllowed(domain)) {
            await injectIntoTab(tab.id!, tab.url);
        }
    });

    browser.tabs.onActivated.addListener(async ({ tabId }: chrome.tabs.OnActivatedInfo) => {
        try {
            const tab = await browser.tabs.get(tabId);
            if (tab.url) {
                const domain = getDomainFromUrl(tab.url);
                if (domain && await isDomainAllowed(domain)) {
                    await injectIntoTab(tabId, tab.url);
                }
            }
        } catch {
            // Tab may have been closed
        }
    });

    if (browser.permissions?.onAdded) {
        browser.permissions.onAdded.addListener(async (permissions: chrome.permissions.Permissions) => {
            if (permissions.origins?.length) {
                try {
                    for (const origin of permissions.origins) {
                        const match = origin.match(/^\*:\/\/(?:\*\.)?([^/]+)\/\*$/);
                        if (match?.[1]) {
                            await addAllowedDomain(match[1]);
                        }
                    }
                    const tabs = await browser.tabs.query({ status: 'complete' });
                    for (const tab of tabs) {
                        if (tab.url && tab.id) {
                            const d = getDomainFromUrl(tab.url);
                            if (d && await isDomainAllowed(d)) {
                                await injectIntoTab(tab.id, tab.url);
                            }
                        }
                    }
                } catch { /* ignored */ }
            }
        });
    }
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['getAllowedDomains', async () => getAllowedDomains()],
    ['isDomainAllowed', async (params) => isDomainAllowed(params.domain as string)],
    ['isDomainDismissed', async (params) => isDomainDismissed(params.domain as string)],
    ['addAllowedDomain', async (params) => addAllowedDomain(params.domain as string)],
    ['removeAllowedDomain', async (params) => removeAllowedDomain(params.domain as string)],
    ['hasHostPermission', async () => hasHostPermission()],
    ['requestHostPermission', async () => requestHostPermission()],
    ['enableForCurrentDomain', async () => enableForCurrentDomain()],

    ['setIdentityDisabled', async (params) => setIdentityDisabled(params.domain as string, params.disabled as boolean)],

    ['getIdentityDisabledSites', async () => {
        const data = await browser.storage.local.get('identityDisabledSites') as Record<string, string[]>;
        return data.identityDisabledSites || [];
    }],

    ['getNostrPubkey', async () => getNostrPubkeyFromActiveTab()],
    ['injectWotApi', async () => injectWotApi()],
]);
