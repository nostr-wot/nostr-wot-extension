
import browser from './lib/browser.ts';
import * as storage from './lib/storage.ts';
import * as vault from './lib/vault.ts';
import * as signer from './lib/signer.ts';
import * as signerPermissions from './lib/permissions.ts';
import { openPopupForActiveTab } from './lib/openPopupForActiveTab.ts';
import { randomHex } from './lib/crypto/utils.ts';

// ── State & handler modules ──

import {
    config,
    NIP07_SIGNING_METHODS,
    checkRateLimit, npubToHex,
    buildPrivilegedMethods, setPrivilegedMethods,
    PRIVILEGED_METHODS,
    type HandlerFn,
} from './lib/bg/state.ts';
import { handlers as relayHandlers } from './lib/bg/relay-handlers.ts';
import { handlers as miscHandlers, logActivity } from './lib/bg/misc-handlers.ts';
import {
    handlers as domainHandlers,
    setupTabListeners, isDomainAllowed, isDomainDismissed,
    waitForDomainAllowed,
    isActiveAccountReadOnly,
    refreshBadgesOnAllTabs,
} from './lib/bg/domain-handlers.ts';
import { handlers as vaultHandlers } from './lib/bg/vault-handlers.ts';
import { handlers as walletHandlers } from './lib/bg/wallet-handlers.ts';
import { handlers as nip07Handlers, validateNip07Params } from './lib/bg/nip07-handlers.ts';
import { handlers as onboardingHandlers } from './lib/bg/onboarding-handlers.ts';

// ── Assemble handler map ──

const allHandlers = new Map<string, HandlerFn>();
const handlerGroups = [relayHandlers, miscHandlers, domainHandlers, vaultHandlers, walletHandlers, nip07Handlers, onboardingHandlers];
for (const group of handlerGroups) {
    for (const [method, fn] of group) {
        if (allHandlers.has(method)) {
            console.error(`[BG] Duplicate handler registration: "${method}" — later registration overwrites earlier one`);
        }
        allHandlers.set(method, fn);
    }
}

// configUpdated stays here because it calls loadConfig which is local
let _refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
allHandlers.set('configUpdated', async () => {
    await loadConfig();
    // Debounce badge refresh — multiple rapid config updates only trigger one refresh
    if (_refreshDebounceTimer) clearTimeout(_refreshDebounceTimer);
    _refreshDebounceTimer = setTimeout(() => { refreshBadgesOnAllTabs(); _refreshDebounceTimer = null; }, 500);
    return { ok: true };
});

// Auto-derive PRIVILEGED_METHODS from all handler maps (no manual allowlist needed)
const privilegedHandlerGroups = [miscHandlers, domainHandlers, vaultHandlers, walletHandlers, nip07Handlers, onboardingHandlers];
setPrivilegedMethods(buildPrivilegedMethods(...privilegedHandlerGroups));
// Also add configUpdated and other locally-defined handlers
PRIVILEGED_METHODS.add('configUpdated');

// ── Config loading ──

async function loadConfig(): Promise<void> {
    const data = await browser.storage.sync.get([
        'myPubkey', 'relays'
    ]) as Record<string, unknown>;

    config.myPubkey = (data.myPubkey as string) || null;

    // Parse relays from comma-separated string
    if (data.relays) {
        config.relays = (data.relays as string).split(',').map(r => r.trim()).filter(Boolean);
    }

    // Initialize storage with active account's database
    const localData = await browser.storage.local.get(['accounts', 'activeAccountId']) as Record<string, unknown>;
    let activeAccountId = localData.activeAccountId as string | undefined;

    // Migration: if no accounts in local storage but myPubkey exists, create one
    if (!activeAccountId && data.myPubkey) {
        let accts = (localData.accounts as Array<{ id: string; name: string; pubkey: string; type: string; readOnly: boolean }>) || [];
        if (accts.length === 0) {
            const id = Date.now().toString(36) + randomHex(6);
            accts = [{ id, name: 'Default', pubkey: data.myPubkey as string, type: 'npub', readOnly: true }];
            activeAccountId = id;
            await browser.storage.local.set({ accounts: accts, activeAccountId: id });
        } else {
            activeAccountId = accts[0].id;
            await browser.storage.local.set({ activeAccountId });
        }
    }

    // Fall back to vault account if still no ID
    if (!activeAccountId) {
        activeAccountId = vault.getActiveAccountId() ?? undefined;
    }

    if (activeAccountId) {
        // initDB recreates a fresh (empty) per-account DB; its relay_lists store
        // backs the relay (NIP-65) feature. The deprecated trust-graph stores it
        // also creates are left unused.
        await storage.initDB(activeAccountId);
    }
}

// ── Request dispatch ──

async function handleRequest({ method, params }: { method: string; params: Record<string, unknown> }): Promise<unknown> {
    // Check rate limit for external API methods
    if (!checkRateLimit(method)) {
        throw new Error(`Rate limit exceeded for ${method}. Max 50 requests per second.`);
    }

    // NIP-07: validate params and gate behind domain allowlist
    if (method.startsWith('nip07_')) {
        validateNip07Params(method, params);
        const origin = params?.origin as string;
        if (!origin) {
            logActivity({ domain: 'unknown', method: method.replace('nip07_', ''), decision: 'blocked' });
            throw new Error('Site not connected');
        }
        if (!(await isDomainAllowed(origin))) {
            // Dismissed domains are silently rejected (user previously denied)
            if (await isDomainDismissed(origin)) {
                logActivity({ domain: origin, method: method.replace('nip07_', ''), decision: 'blocked' });
                throw new Error('Site not connected');
            }
            // First visit: open the popup so the user sees the "Connect this site"
            // card — but only when the request comes from the tab they're actually
            // looking at. A background/inactive tab making nostr requests (or one
            // polling) must not pop the popup open.
            await openPopupForActiveTab(origin);
            // Wait for the user to click Connect (domain added to allowedDomains)
            const connected = await waitForDomainAllowed(origin);
            if (!connected) {
                logActivity({ domain: origin, method: method.replace('nip07_', ''), decision: 'blocked' });
                throw new Error('Site not connected');
            }
        }
    }

    // Gate WebLN methods (except enable) behind the same domain allowlist
    if (method.startsWith('webln_') && method !== 'webln_enable') {
        const origin = params?.origin as string;
        if (!origin || !(await isDomainAllowed(origin))) {
            logActivity({ domain: origin || 'unknown', method: method.replace('webln_', ''), decision: 'blocked' });
            throw new Error('Site not connected');
        }
    }

    // Read-only account guard
    if (NIP07_SIGNING_METHODS.has(method) && await isActiveAccountReadOnly()) {
        logActivity({ domain: params?.origin as string, method: method.replace('nip07_', ''), decision: 'blocked' });
        throw new Error('Signing not available for read-only accounts');
    }

    // Normalize pubkey params from npub to hex (used by relay-list and profile handlers)
    if (params?.pubkey) params.pubkey = npubToHex(params.pubkey as string) || params.pubkey;
    if (Array.isArray(params?.pubkeys)) {
        params.pubkeys = (params.pubkeys as string[]).map(t => npubToHex(t) || t);
    }

    const handler = allHandlers.get(method);
    if (!handler) {
        throw new Error(`Unknown method: ${method}`);
    }

    return await handler(params);
}

// ── Message listeners ──

browser.runtime.onMessage.addListener((request: Record<string, unknown>, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
    const method = request?.method as string | undefined;

    // Gate privileged methods to internal extension pages only
    if (method && PRIVILEGED_METHODS.has(method)) {
        const senderUrl = sender.url || sender.tab?.url || '';
        const isInternal = sender.id === browser.runtime.id &&
            (!sender.tab || senderUrl.startsWith(browser.runtime.getURL('')));
        if (!isInternal) {
            sendResponse({ error: 'Permission denied' });
            return true;
        }
    }

    // Defense-in-depth: derive NIP-07 origin from browser-verified sender info
    if (method?.startsWith('nip07_')) {
        const originUrl = sender.frameId === 0
            ? sender.tab?.url
            : (sender.url || sender.tab?.url);
        if (!originUrl) {
            sendResponse({ error: 'Cannot determine request origin' });
            return true;
        }
        (request.params as Record<string, unknown>).origin = new URL(originUrl).hostname;
    }

    handleRequest(request as { method: string; params: Record<string, unknown> })
        .then(result => {
            sendResponse({ result });
        })
        .catch(error => {
            sendResponse({ error: (error as Error).message || (error as { name?: string }).name || 'Unknown error' });
        });
    return true;
});

// Port-based handler for NIP-07 and WebLN requests from content scripts
browser.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
    if (port.name !== 'nip07' && port.name !== 'webln') return;

    port.onMessage.addListener(async (request: Record<string, unknown>) => {
        const method = request.method as string;

        // Defense-in-depth: derive origin from browser-verified sender info
        if (method?.startsWith('nip07_') || method?.startsWith('webln_')) {
            const originUrl = port.sender?.frameId === 0
                ? port.sender?.tab?.url
                : (port.sender?.url || port.sender?.tab?.url);
            if (!originUrl) {
                try { port.postMessage({ error: 'Cannot determine request origin' }); } catch {}
                return;
            }
            (request.params as Record<string, unknown>).origin = new URL(originUrl).hostname;
        }

        try {
            const result = await handleRequest(request as { method: string; params: Record<string, unknown> });
            try { port.postMessage({ result }); } catch {}
        } catch (error) {
            console.error('[PORT]', port.name, 'error:', method, (error as Error).message);
            try { port.postMessage({ error: (error as Error).message || 'Unknown error' }); } catch {}
        }
    });
});

// Keep-alive alarm: while the vault is unlocked in timed-lock mode, lib/vault.ts
// arms a periodic 'vault-keepalive' alarm. Each tick does a trivial async
// storage read, which resets the Chrome MV3 service-worker idle timer and keeps
// the in-memory decrypted key alive until the configured auto-lock fires —
// instead of the SW being torn down early (e.g. on page refresh, bug #10).
// Guarded for environments without browser.alarms (Safari persistent background
// page, tests).
if (browser.alarms?.onAlarm) {
    browser.alarms.onAlarm.addListener((alarm: chrome.alarms.Alarm) => {
        if (alarm.name === 'vault-keepalive') {
            // Trivial read just to reset the SW idle timer; result is unused.
            browser.storage.local.get('autoLockMs').catch(() => {});
        }
    });
}

// ── Startup (runs AFTER listeners are registered, so messages during async
// init don't race against listener registration) ──

// Silently delete the deprecated trust-graph databases on startup. The WoT
// subsystem (graph/sync/oracles/scoring/badges) has been removed; its
// per-account `nostr-wot-{accountId}` IndexedDB stores are dead data. Deleting
// them BEFORE loadConfig() lets initDB recreate a fresh empty DB for the active
// account (whose relay_lists store still backs the relay feature). Guarded so a
// cleanup failure never blocks startup.
(async () => {
    try {
        const dbs = await storage.listAllDatabases();
        for (const d of dbs) {
            try {
                await storage.deleteDatabase(d.accountId);
            } catch { /* ignore individual delete failures */ }
        }
    } catch { /* ignore — listAllDatabases unsupported or failed */ }
    // Recreate the active account's empty DB after the wipe.
    loadConfig();
})();

signer.cleanupStale();

// Permission migrations
(async () => {
    try {
        const data = await browser.storage.local.get('_permMigrationVersion');
        if ((data as Record<string, unknown>)._permMigrationVersion !== 4) {
            await signerPermissions.migrateToPerKind();
            await signerPermissions.migrateToPerAccount();
            await signerPermissions.migrateForwardToAsk();
            await signerPermissions.migrateDmKindsToSendMessages();
            await browser.storage.local.set({ _permMigrationVersion: 4 });
        }
    } catch (e: unknown) {
        console.warn('[PERMISSIONS] Migration failed:', (e as Error).message);
    }
})();

// Auto-unlock vault when auto-lock is "Never"
(async () => {
    try {
        // Restore the configured auto-lock interval on cold start. _autoLockMs is
        // module-level in-memory state that otherwise reverts to the 15-min default
        // every time the service worker restarts (bug #10).
        await vault.restoreAutoLockSetting();
        const data = await browser.storage.local.get(['autoLockMs', 'activeAccountId']);
        if (((data as Record<string, unknown>).autoLockMs ?? 900000) === 0 && await vault.exists()) {
            const ok = await vault.unlock('');
            if (ok) {
                if ((data as Record<string, unknown>).activeAccountId) {
                    try {
                        await vault.setActiveAccount((data as Record<string, unknown>).activeAccountId as string);
                    } catch {
                        vault.clearActiveAccount();
                    }
                }
                await signer.onVaultUnlocked();
            }
        }
    } catch (e: unknown) {
        console.warn('[VAULT] Auto-unlock failed:', (e as Error).message);
    }
})();

// Tab listeners for auto-injection
setupTabListeners();
