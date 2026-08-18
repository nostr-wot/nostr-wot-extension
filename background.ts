
import browser from './lib/browser.ts';
import * as vault from './lib/vault.ts';
import * as signer from './lib/signer.ts';
import * as signerPermissions from './lib/permissions.ts';
import { openPopupForActiveTab } from './lib/openPopupForActiveTab.ts';
import { randomHex } from './lib/crypto/utils.ts';

// ── State & handler modules ──

import {
    config,
    NIP07_SIGNING_METHODS,
    npubToHex,
    buildPrivilegedMethods, setPrivilegedMethods,
    PRIVILEGED_METHODS,
    type HandlerFn,
} from './lib/bg/state.ts';
import { handlers as miscHandlers, logActivity } from './lib/bg/misc-handlers.ts';
import {
    handlers as domainHandlers,
    isDomainAllowed, isDomainDismissed,
    rememberTabOrigin, forgetTabOrigin,
    releaseLegacyHostGrants,
    isWeblnAllowed,
    waitForConnectDecision,
    isActiveAccountReadOnly,
} from './lib/bg/domain-handlers.ts';
import { handlers as vaultHandlers } from './lib/bg/vault-handlers.ts';
import { handlers as walletHandlers } from './lib/bg/wallet-handlers.ts';
import { handlers as nip07Handlers, validateNip07Params } from './lib/bg/nip07-handlers.ts';
import { handlers as onboardingHandlers, cleanupExpiredPendingOnboarding } from './lib/bg/onboarding-handlers.ts';
import { handlers as pqcHandlers } from './lib/bg/pqc-handlers.ts';

// ── Assemble handler map ──

const allHandlers = new Map<string, HandlerFn>();
const handlerGroups = [miscHandlers, domainHandlers, vaultHandlers, walletHandlers, nip07Handlers, onboardingHandlers, pqcHandlers];
for (const group of handlerGroups) {
    for (const [method, fn] of group) {
        if (allHandlers.has(method)) {
            console.error(`[BG] Duplicate handler registration: "${method}" — later registration overwrites earlier one`);
        }
        allHandlers.set(method, fn);
    }
}

// configUpdated stays here because it calls loadConfig which is local
allHandlers.set('configUpdated', async () => {
    await loadConfig();
    return { ok: true };
});

// Auto-derive PRIVILEGED_METHODS from all handler maps (no manual allowlist needed)
const privilegedHandlerGroups = [miscHandlers, domainHandlers, vaultHandlers, walletHandlers, nip07Handlers, onboardingHandlers, pqcHandlers];
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

    // Ensure an active account exists in local storage.
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
}

// ── Request dispatch ──

async function handleRequest(
    { method, params }: { method: string; params: Record<string, unknown> },
    requestingTabId?: number,
): Promise<unknown> {
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
            // Waits for the user to click Connect (domain added to allowedDomains)
            // or "Not now" (domain dismissed).
            const connected = await waitForConnectDecision(origin, requestingTabId);
            if (!connected) {
                logActivity({ domain: origin, method: method.replace('nip07_', ''), decision: 'blocked' });
                throw new Error('Site not connected');
            }
        }
    }

    // Gate WebLN methods behind explicit WebLN consent. enable() is the consent
    // entry point: like NIP-07, an un-connected origin opens the "Connect this
    // site" popup and we wait for the user to approve — WebLN access (balance,
    // node info, invoices) is NEVER granted silently. Every other WebLN method
    // requires the origin to be in weblnAllowedDomains (recorded by the
    // webln_enable handler after the user's Connect click) — being NIP-07
    // connected alone is NOT enough — and never pops UI on its own.
    if (method.startsWith('webln_')) {
        const origin = params?.origin as string;
        if (!origin) {
            logActivity({ domain: 'unknown', method: method.replace('webln_', ''), decision: 'blocked' });
            throw new Error('Site not connected');
        }
        if (method === 'webln_enable') {
            // Whether the Connect card was shown for THIS wallet request. If it was, the
            // user answered a prompt raised by the wallet call and that is the consent. If
            // the site was already connected over NIP-07, they have seen nothing about the
            // wallet, and the handler must ask before granting it.
            (params as Record<string, unknown>).shownConnectCard = false;
            if (!(await isDomainAllowed(origin))) {
                if (!(await isDomainDismissed(origin))) {
                    // First enable(): show the Connect card on the active tab and
                    // wait for the user's click (which adds the domain to the
                    // allowlist). Background/inactive tabs get no popup and time out.
                    const connected = await waitForConnectDecision(origin, requestingTabId);
                    if (!connected) {
                        logActivity({ domain: origin, method: 'enable', decision: 'blocked' });
                        throw new Error('WebLN access denied');
                    }
                    (params as Record<string, unknown>).shownConnectCard = true;
                } else {
                    logActivity({ domain: origin, method: 'enable', decision: 'blocked' });
                    throw new Error('Site not connected');
                }
            }
        } else if (!(await isWeblnAllowed(origin))) {
            logActivity({ domain: origin, method: method.replace('webln_', ''), decision: 'blocked' });
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

    // The requesting tab's id, so the connect gate can tell "this is the tab the user is
    // looking at" without needing to read its URL — which tabs.query strips unless we hold
    // an explicit host permission for it. See lib/originMatchesActiveTab.ts.
    handleRequest(request as { method: string; params: Record<string, unknown> }, sender.tab?.id)
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

    port.onDisconnect.addListener(() => forgetTabOrigin(port.sender?.tab?.id));

    port.onMessage.addListener(async (request: Record<string, unknown>) => {
        const method = request.method as string;

        // Defense-in-depth: the port channel is exposed to content scripts on
        // arbitrary pages, so only NIP-07 and WebLN methods may cross it.
        // Privileged methods (vault_/signer_/wallet_/...) are for internal
        // extension pages via onMessage only — mirror that gate here so the
        // port can never reach them even if content.ts regresses.
        if (!method?.startsWith('nip07_') && !method?.startsWith('webln_')) {
            try { port.postMessage({ error: 'Permission denied' }); } catch {}
            return;
        }

        // Defense-in-depth: derive origin from browser-verified sender info
        if (method?.startsWith('nip07_') || method?.startsWith('webln_')) {
            const originUrl = port.sender?.frameId === 0
                ? port.sender?.tab?.url
                : (port.sender?.url || port.sender?.tab?.url);
            if (!originUrl) {
                try { port.postMessage({ error: 'Cannot determine request origin' }); } catch {}
                return;
            }
            const originHost = new URL(originUrl).hostname;
            (request.params as Record<string, unknown>).origin = originHost;
            // Remember which tab is showing which origin, so account-change broadcasts do
            // not depend on tabs.query returning a URL we are not permitted to see.
            rememberTabOrigin(port.sender?.tab?.id, originHost);
        }

        try {
            const result = await handleRequest(
                request as { method: string; params: Record<string, unknown> },
                port.sender?.tab?.id,
            );
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

loadConfig();

signer.cleanupStale();

// Drop an abandoned onboarding record. Matters on Safari, where storage.session is
// storage.local and an expired record would otherwise sit on disk indefinitely.
cleanupExpiredPendingOnboarding().catch(() => {});

// Hand back the per-site host permissions older versions asked for. They gated nothing,
// and until they are removed Chrome still lists those sites as ones we can read.
releaseLegacyHostGrants()
    .then((released) => { if (released.length) console.info('[BG] released', released.length, 'legacy host grants'); })
    .catch(() => {});

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

// Auto-unlock vault when auto-lock is "Never".
//
// Registered through vault.beginStartupUnlock so request paths can await it:
// this runs on EVERY service-worker cold start and takes a few hundred ms
// (PBKDF2), during which the vault reports locked. A signEvent landing in that
// window used to queue an unlock marker and pop the popup open even though the
// site's permission was already saved as 'allow'.
vault.beginStartupUnlock(async () => {
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
});
