/**
 * Domain, badge, tab, and injection handlers.
 * @module lib/bg/domain-handlers
 */

import browser from '../browser.ts';
import { getDomainFromUrl } from '@shared/url.ts';
import { openPopupForActiveTab } from '../openPopupForActiveTab.ts';
import { isRestrictedUrl, type HandlerFn, type LocalAccountEntry } from './state.ts';

// ── Domain permission functions (with in-memory cache) ──

let _cachedDomains: string[] | null = null;
let _cachedWeblnDomains: string[] | null = null;
let _cachedDismissedDomains: string[] | null = null;
let _cachedAccountReadOnly: { accountId: string | undefined; readOnly: boolean } | null = null;

function invalidateDomainCache(): void { _cachedDomains = null; }
function invalidateWeblnDomainCache(): void { _cachedWeblnDomains = null; }
function invalidateDismissedCache(): void { _cachedDismissedDomains = null; }
function invalidateAccountCache(): void { _cachedAccountReadOnly = null; }

// Invalidate caches on external storage changes
try {
    browser.storage.onChanged.addListener((changes: Record<string, unknown>, area: string) => {
        if (area === 'local') {
            if ((changes as Record<string, unknown>).allowedDomains) invalidateDomainCache();
            if ((changes as Record<string, unknown>).weblnAllowedDomains) invalidateWeblnDomainCache();
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
    // Disconnecting a site revokes its WebLN consent too — a re-connected
    // site must call enable() again before it can touch the wallet.
    await removeWeblnAllowedDomain(domain);
    return true;
}

// ── WebLN-allowed domains (separate consent from the NIP-07 connect) ──
//
// A NIP-07-connected site does NOT automatically get wallet access. WebLN
// consent is recorded only when the site calls webln.enable() and the user
// approves the Connect card for it. Every webln_* method except enable is
// gated on this list (see background.ts).

export async function getWeblnAllowedDomains(): Promise<string[]> {
    if (_cachedWeblnDomains !== null) return _cachedWeblnDomains;
    const data = await browser.storage.local.get('weblnAllowedDomains');
    _cachedWeblnDomains = (data as Record<string, string[]>).weblnAllowedDomains || [];
    return _cachedWeblnDomains;
}

export async function isWeblnAllowed(domain: string): Promise<boolean> {
    const domains = await getWeblnAllowedDomains();
    return domains.includes(domain);
}

export async function addWeblnAllowedDomain(domain: string): Promise<boolean> {
    const domains = await getWeblnAllowedDomains();
    if (!domains.includes(domain)) {
        domains.push(domain);
        await browser.storage.local.set({ weblnAllowedDomains: domains });
        invalidateWeblnDomainCache();
    }
    return true;
}

export async function removeWeblnAllowedDomain(domain: string): Promise<boolean> {
    const domains = await getWeblnAllowedDomains();
    const filtered = domains.filter(d => d !== domain);
    await browser.storage.local.set({ weblnAllowedDomains: filtered });
    invalidateWeblnDomainCache();
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
 * Wait for the user's decision on the "Connect this site" card.
 * Resolves true when the domain is added to allowedDomains ("Connect"), false
 * when it is dismissed ("Not now") or the wait times out.
 * Used after opening the popup so the user can answer.
 */
export function waitForDomainAllowed(domain: string): Promise<boolean> {
    return new Promise((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout>;

        function finish(value: boolean): void {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            browser.storage.onChanged.removeListener(listener);
            resolve(value);
        }

        function listener(changes: Record<string, unknown>, area: string) {
            if (area !== 'local') return;
            if ((changes as Record<string, unknown>).allowedDomains) {
                // Check if the domain is now allowed
                isDomainAllowed(domain).then((allowed) => { if (allowed) finish(true); });
            }
            // "Not now" on the connect card: reject the site's request right
            // away instead of holding it open for the full 2-minute timeout.
            if ((changes as Record<string, unknown>).dismissedDomains) {
                isDomainDismissed(domain).then((dismissed) => { if (dismissed) finish(false); });
            }
        }

        timer = setTimeout(() => finish(false), CONNECT_WAIT_TIMEOUT_MS);
        browser.storage.onChanged.addListener(listener);

        // The listener only ever sees CHANGES, so a connect that landed between the
        // caller's isDomainAllowed() check and this line would never arrive — the site's
        // request would hang for the full two minutes and then be rejected, despite the
        // user having connected. Re-read once now that the listener is attached; anything
        // later is a real change and the listener catches it.
        //
        // Only the allowed side is re-read. A dismissal cannot be missed the same way:
        // background.ts rejects a dismissed origin before ever opening this gate, so the
        // gate is only ever entered for an undecided domain.
        isDomainAllowed(domain).then((allowed) => { if (allowed) finish(true); });
    });
}

// In-flight connect gates, keyed by origin. A page that calls several NIP-07
// methods at once (or polls one) would otherwise run the gate once per call,
// re-opening the popup each time — including right after the user closed it.
// The first call owns the gate; every other call awaits the same decision.
const _connectWaits = new Map<string, Promise<boolean>>();

/**
 * Show the "Connect this site" card for `origin` and wait for the user's
 * answer. Concurrent calls for the same origin share one popup and one wait.
 * @returns true if the user connected the site, false on "Not now" or timeout.
 */
export function waitForConnectDecision(origin: string): Promise<boolean> {
    const existing = _connectWaits.get(origin);
    if (existing) return existing;

    const wait = (async () => {
        try {
            await openPopupForActiveTab(origin);
            return await waitForDomainAllowed(origin);
        } catch {
            return false;
        } finally {
            _connectWaits.delete(origin);
        }
    })();

    _connectWaits.set(origin, wait);
    return wait;
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
            const domain = getDomainFromUrl(tab.url || '');
            if (!domain) continue;
            // Only notify origins the user has actually connected (and not
            // disabled identity for). Broadcasting the active pubkey to every
            // open tab would leak the user's Nostr identity to unconnected —
            // possibly hostile — sites idling in background tabs, defeating the
            // getPublicKey consent gate.
            if (!(await isDomainAllowed(domain))) continue;
            if (await isIdentityDisabled(domain)) continue;
            browser.tabs.sendMessage(tab.id!, { type: 'NOSTR_ACCOUNT_CHANGED', pubkey }).catch(() => {});
        }
    } catch (e: unknown) {
        console.warn('[BG] broadcastAccountChanged failed:', (e as Error).message);
    }
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
        return { ok: true, domain, error: null };
    } catch (e: unknown) {
        return { ok: false, error: (e as Error).message };
    }
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

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['getAllowedDomains', async () => getAllowedDomains()],
    ['isDomainAllowed', async (params) => isDomainAllowed(params.domain as string)],
    ['isDomainDismissed', async (params) => isDomainDismissed(params.domain as string)],
    ['addAllowedDomain', async (params) => addAllowedDomain(params.domain as string)],
    ['removeAllowedDomain', async (params) => removeAllowedDomain(params.domain as string)],
    // "Not now" on the connect card. Without this the dismissal was never
    // recorded, so the next request from the site re-opened the popup.
    ['addDismissedDomain', async (params) => addDismissedDomain(params.domain as string)],
    ['hasHostPermission', async () => hasHostPermission()],
    ['requestHostPermission', async () => requestHostPermission()],
    ['enableForCurrentDomain', async () => enableForCurrentDomain()],

    ['setIdentityDisabled', async (params) => setIdentityDisabled(params.domain as string, params.disabled as boolean)],

    ['getIdentityDisabledSites', async () => {
        const data = await browser.storage.local.get('identityDisabledSites') as Record<string, string[]>;
        return data.identityDisabledSites || [];
    }],
]);
