/**
 * Domain, badge, tab, and injection handlers.
 * @module lib/bg/domain-handlers
 */

import browser from '../browser.ts';
import { getDomainFromUrl } from '@shared/url.ts';
import { openPopupForActiveTab } from '../openPopupForActiveTab.ts';
import { isRestrictedUrl, type HandlerFn, type LocalAccountEntry } from './state.ts';
import * as signerPermissions from '../permissions.ts';

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
    // And its signing rules. Leaving them behind made Disconnect a suggestion: the popup
    // treated a site with any stored permission as connected and silently re-added it.
    await signerPermissions.clearAllForDomain(domain);
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

// ── Dismissed domains (declined connect prompts) ──
//
// "Not now" used to mean "never, silently, with no way back": the domain went into a plain
// string array, `background.ts` rejected it before the connect gate forever, and nothing in
// the UI ever showed it. A user who declined once on a site they were merely unsure about
// had no way to find out why that site never worked again.
//
// A dismissal now carries a lifetime, chosen by the user:
//   a timestamp  — "Not now", expires after the configured duration
//   'session'    — until the browser restarts (kept in storage.session, which is cleared then)
//   'never'      — the explicit "Never" button
//
// Even 'never' is listed in site settings with an undo, so permanence is a visible state
// rather than folklore.

export type DismissalLifetime = number | 'session' | 'never';

export interface Dismissal {
    at: number;
    until: DismissalLifetime;
}

const DISMISS_DURATION_KEY = 'dismissDurationMs';
const SESSION_DISMISSED_KEY = 'sessionDismissedDomains';

/** 0 means "until the browser restarts". */
export const DISMISS_DURATIONS = [0, 86_400_000, 604_800_000, 2_592_000_000] as const;
const DISMISS_DURATION_DEFAULT = 604_800_000; // 7 days

export async function getDismissDuration(): Promise<number> {
    const data = await browser.storage.local.get(DISMISS_DURATION_KEY) as Record<string, number>;
    const ms = data[DISMISS_DURATION_KEY];
    return typeof ms === 'number' && DISMISS_DURATIONS.includes(ms as never) ? ms : DISMISS_DURATION_DEFAULT;
}

export async function setDismissDuration(ms: number): Promise<boolean> {
    if (!DISMISS_DURATIONS.includes(ms as never)) throw new Error('Unsupported dismissal duration');
    await browser.storage.local.set({ [DISMISS_DURATION_KEY]: ms });
    return true;
}

/**
 * Read the store, migrating the legacy `string[]` shape on the way.
 *
 * Legacy entries carry no date, so their clock starts now rather than expiring instantly:
 * someone who declined a nagging site yesterday should not have it return the moment they
 * upgrade. One duration later they are free either way.
 */
async function getDismissals(): Promise<Record<string, Dismissal>> {
    const data = await browser.storage.local.get('dismissedDomains') as Record<string, unknown>;
    const raw = data.dismissedDomains;

    if (Array.isArray(raw)) {
        const now = Date.now();
        const duration = await getDismissDuration();
        const migrated: Record<string, Dismissal> = {};
        for (const domain of raw as string[]) {
            if (typeof domain === 'string' && domain) {
                migrated[domain] = { at: now, until: duration === 0 ? 'session' : now + duration };
            }
        }
        await browser.storage.local.set({ dismissedDomains: migrated });
        invalidateDismissedCache();
        return migrated;
    }
    return (raw as Record<string, Dismissal>) || {};
}

async function getSessionDismissed(): Promise<string[]> {
    const data = await browser.storage.session.get(SESSION_DISMISSED_KEY) as Record<string, string[]>;
    return data[SESSION_DISMISSED_KEY] || [];
}

/** Every live dismissal, expired ones swept, for the settings list. */
export async function getDismissedDomains(): Promise<Array<{ domain: string; until: DismissalLifetime }>> {
    const dismissals = await getDismissals();
    const now = Date.now();
    const live: Array<{ domain: string; until: DismissalLifetime }> = [];
    const kept: Record<string, Dismissal> = {};
    let expired = false;

    for (const [domain, d] of Object.entries(dismissals)) {
        if (typeof d?.until === 'number' && d.until <= now) { expired = true; continue; }
        kept[domain] = d;
        if (d.until !== 'session') live.push({ domain, until: d.until });
    }
    if (expired) {
        await browser.storage.local.set({ dismissedDomains: kept });
        invalidateDismissedCache();
    }
    for (const domain of await getSessionDismissed()) live.push({ domain, until: 'session' });
    return live;
}

export async function isDomainDismissed(domain: string): Promise<boolean> {
    if ((await getSessionDismissed()).includes(domain)) return true;
    const dismissals = await getDismissals();
    const entry = dismissals[domain];
    if (!entry) return false;
    if (entry.until === 'never') return true;
    if (entry.until === 'session') return false; // recorded in the session store; browser restarted
    if (entry.until > Date.now()) return true;
    await removeDismissedDomain(domain);
    return false;
}

/**
 * Decline a site.
 * @param domain
 * @param permanent true for the explicit "Never" button; otherwise the user's chosen duration
 */
export async function addDismissedDomain(domain: string, permanent = false): Promise<boolean> {
    if (!domain) return false;
    const now = Date.now();
    const duration = await getDismissDuration();

    if (!permanent && duration === 0) {
        const session = await getSessionDismissed();
        if (!session.includes(domain)) {
            await browser.storage.session.set({ [SESSION_DISMISSED_KEY]: [...session, domain] });
        }
        return true;
    }

    const dismissals = await getDismissals();
    dismissals[domain] = { at: now, until: permanent ? 'never' : now + duration };
    await browser.storage.local.set({ dismissedDomains: dismissals });
    invalidateDismissedCache();
    return true;
}

export async function removeDismissedDomain(domain: string): Promise<void> {
    const dismissals = await getDismissals();
    if (dismissals[domain]) {
        delete dismissals[domain];
        await browser.storage.local.set({ dismissedDomains: dismissals });
        invalidateDismissedCache();
    }
    const session = await getSessionDismissed();
    if (session.includes(domain)) {
        await browser.storage.session.set({ [SESSION_DISMISSED_KEY]: session.filter(d => d !== domain) });
    }
}

// ── Connecting a site ──

/**
 * Connect a site: the one and only writer of `allowedDomains`.
 *
 * Clicking "Connect this site" IS the consent, and it is the whole ceremony. There used to
 * be a second step — the popup asked the browser for `*://<domain>/*` host access — but
 * that dialog gated nothing. Identity release is decided here, by this list; no NIP-07 path
 * consults `permissions.contains`. Meanwhile the dialog asked the browser's question ("may
 * this extension read and change data on this site?") when the extension's own question is
 * the one that matters, and the power it described was already granted at install by the
 * `<all_urls>` content-script declaration that puts `window.nostr` on the page in the first
 * place. It also created two bugs on its own: it dismissed the popup, losing the click, and
 * once the click was made durable it released the identity while the dialog was still
 * unanswered.
 *
 * Keeping this as the single writer is what makes the allowlist trustworthy — the popup's
 * site state, the NIP-07 gate, the signer shortcut and the account broadcast all read it.
 *
 * @param domain hostname the user chose to connect
 */
export async function connectDomain(domain: string): Promise<{ connected: boolean }> {
    if (!domain) return { connected: false };
    await addAllowedDomain(domain);
    // Connecting is also an explicit decision to let the site see the identity, so it
    // clears any earlier per-site identity block.
    await setIdentityDisabled(domain, false);
    return { connected: true };
}

/**
 * Hand back the per-site host permissions earlier versions asked for.
 *
 * Up to 0.5.0 the Connect flow requested `*://<site>/*` for every site connected. Those
 * grants gated nothing — the allowlist decides identity release — but they persist in the
 * browser, so Chrome keeps listing each site as one this extension can read and change.
 * Removing them is the whole point of dropping the request: without this, users who
 * already connected sites keep the footprint they were trying to shed.
 *
 * `permissions.remove` needs no user gesture and raises no prompt; shedding permissions is
 * never something the browser asks about. Only site patterns are touched.
 *
 * @returns the origins released
 */
export async function releaseLegacyHostGrants(): Promise<string[]> {
    try {
        const current = await browser.permissions.getAll();
        const origins = (current?.origins || []).filter(o => /^\*:\/\/[^/]+\/\*$/.test(o));
        if (origins.length === 0) return [];
        // One call: a partial failure should leave nothing half-released.
        const removed = await browser.permissions.remove({ origins });
        return removed ? origins : [];
    } catch {
        // Firefox grants content-script origins at install and manages them in about:addons;
        // if the browser refuses, leave it to the browser's own UI.
        return [];
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
export function waitForConnectDecision(origin: string, requestingTabId?: number): Promise<boolean> {
    const existing = _connectWaits.get(origin);
    if (existing) return existing;

    const wait = (async () => {
        try {
            await openPopupForActiveTab(origin, requestingTabId);
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



// ── Tab broadcast / refresh ──

// Which tab is showing which origin, learned from the ports content scripts open.
//
// This used to be read from tabs.query()'s `tab.url`, but Chrome strips url/title/
// favIconUrl unless the extension holds "tabs" or an explicit host permission for that
// tab — and content-script `matches` do not count. With no per-site grants there is no
// url to filter on, so every tab was skipped and connected sites silently stopped hearing
// about account switches.
//
// `port.sender` is not permission-gated (the connect gate already depends on that), so
// the content script telling us it exists is a better source than asking the tabs API.
// Two knowing limits: only tabs that made at least one NIP-07/WebLN call are registered —
// a page that never called holds no pubkey and has nothing to update — and the registry
// dies with the service worker, which is self-healing because the ports die with it too.
const _tabOrigins = new Map<number, string>();

/** Remember that `tabId` is showing `origin`. Called when a content-script port connects. */
export function rememberTabOrigin(tabId: number | undefined, origin: string): void {
    if (typeof tabId !== 'number' || !origin) return;
    _tabOrigins.set(tabId, origin);
}

/** Forget a tab, on port disconnect or tab close. */
export function forgetTabOrigin(tabId: number | undefined): void {
    if (typeof tabId === 'number') _tabOrigins.delete(tabId);
}

/** Which origin is a given tab showing, as learned from its content-script port. */
export function getTabOrigin(tabId: number | undefined): string | null {
    if (typeof tabId !== 'number') return null;
    return _tabOrigins.get(tabId) ?? null;
}

/** Test seam: the registry is in-memory and otherwise unobservable. */
export function __getTabOrigins(): Map<number, string> {
    return _tabOrigins;
}

export async function broadcastAccountChanged(pubkey: string): Promise<void> {
    try {
        for (const [tabId, domain] of _tabOrigins) {
            // Only notify origins the user has actually connected (and not disabled
            // identity for). Broadcasting the active pubkey to every open tab would leak
            // the user's Nostr identity to unconnected — possibly hostile — sites idling
            // in background tabs, defeating the getPublicKey consent gate.
            if (!(await isDomainAllowed(domain))) continue;
            if (await isIdentityDisabled(domain)) continue;
            browser.tabs.sendMessage(tabId, { type: 'NOSTR_ACCOUNT_CHANGED', pubkey }).catch(() => {});
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


// ── Host access request (Chrome 133+) ──


// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['getAllowedDomains', async () => getAllowedDomains()],
    ['isDomainAllowed', async (params) => isDomainAllowed(params.domain as string)],
    ['isDomainDismissed', async (params) => isDomainDismissed(params.domain as string)],
    ['addAllowedDomain', async (params) => addAllowedDomain(params.domain as string)],
    ['removeAllowedDomain', async (params) => removeAllowedDomain(params.domain as string)],
    // "Not now" on the connect card. Without this the dismissal was never
    // recorded, so the next request from the site re-opened the popup.
    ['addDismissedDomain', async (params) => addDismissedDomain(params.domain as string, !!params.permanent)],
    ['getDismissedDomains', async () => getDismissedDomains()],
    ['removeDismissedDomain', async (params) => { await removeDismissedDomain(params.domain as string); return { ok: true }; }],
    ['getDismissDuration', async () => getDismissDuration()],
    ['setDismissDuration', async (params) => setDismissDuration(params.ms as number)],

    // The single consent point. See connectDomain.
    ['connectDomain', async (params) => connectDomain(params.domain as string)],

    // Lets the popup name the current site without reading tab.url, which the browser
    // withholds from an extension holding no host permissions.
    ['getTabOrigin', async (params) => getTabOrigin(params.tabId as number)],

    ['setIdentityDisabled', async (params) => setIdentityDisabled(params.domain as string, params.disabled as boolean)],

    ['getIdentityDisabledSites', async () => {
        const data = await browser.storage.local.get('identityDisabledSites') as Record<string, string[]>;
        return data.identityDisabledSites || [];
    }],
]);
