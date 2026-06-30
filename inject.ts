/**
 * inject.ts — Page-context script exposing window.nostr (NIP-07), window.nostr.wot, and window.webln
 *
 * Runs in MAIN world (page context). Cannot use ES module imports.
 * All NIP-07 and WebLN methods are thin message-passing wrappers — no crypto happens here.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/07.md — NIP-07: window.nostr capability for web browsers
 */

export {}; // make this a module for declare global

interface PendingEntry {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
}

interface NostrNip04 {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
}

interface NostrNip44 {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
}

interface RelayListEntry {
    url: string;
    read: boolean;
    write: boolean;
}

interface RelayPoolEntry {
    url: string;
    endorsements: number;
}

interface WotApi {
    getRelayList: (pubkey: string) => Promise<RelayListEntry[] | null>;
    getRelayPool: () => Promise<RelayPoolEntry[]>;
}

interface SignedEvent {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
}

interface WebLNProvider {
    enabled: boolean;
    enable(): Promise<void>;
    getInfo(): Promise<{ node: { alias: string; pubkey: string } }>;
    sendPayment(paymentRequest: string): Promise<{ preimage: string }>;
    makeInvoice(args: { amount: number; defaultMemo?: string }): Promise<{ paymentRequest: string }>;
    getBalance(): Promise<{ balance: number }>;
}

interface NostrProvider {
    wot: WotApi;
    getPublicKey: () => Promise<string>;
    signEvent: (event: Record<string, unknown>) => Promise<SignedEvent>;
    getRelays: () => Promise<Record<string, { read: boolean; write: boolean }>>;
    nip04: NostrNip04;
    nip44: NostrNip44;
}

declare global {
    interface Window {
        __nostrWotInjected?: boolean;
        nostr: NostrProvider;
        webln?: WebLNProvider;
    }
}

(() => {
    // Guard against double injection
    if (window.__nostrWotInjected) return;
    window.__nostrWotInjected = true;

    // Crypto-random request ID generator (prevents response spoofing from page scripts)
    function randomId(): string {
        const buf = new Uint8Array(16);
        crypto.getRandomValues(buf);
        return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
    }

    // ── Channel factory ──
    // Eliminates duplication across WoT, NIP-07, and WebLN pending maps and call functions.

    function createChannel(msgType: string, responseType: string, timeoutMs: number) {
        const pending = new Map<string, PendingEntry>();

        function call(method: string, params?: unknown): Promise<unknown> {
            return new Promise((resolve, reject) => {
                const id = randomId();
                const timeoutId = setTimeout(() => {
                    pending.delete(id);
                    reject(new Error(`${msgType} timeout: ${method}`));
                }, timeoutMs);
                pending.set(id, { resolve, reject, timeoutId });
                window.postMessage({ type: msgType, id, method, params }, window.location.origin);
            });
        }

        function handleResponse(ev: MessageEvent): void {
            if (ev.data?.type !== responseType) return;
            const entry = pending.get(ev.data.id);
            if (!entry) return;
            clearTimeout(entry.timeoutId);
            pending.delete(ev.data.id);
            if (ev.data.error) entry.reject(new Error(ev.data.error));
            else entry.resolve(ev.data.result);
        }

        return { call, handleResponse };
    }

    const wot = createChannel('WOT_REQUEST', 'WOT_RESPONSE', 30_000);
    const nip07 = createChannel('NIP07_REQUEST', 'NIP07_RESPONSE', 120_000);
    const webln = createChannel('WEBLN_REQUEST', 'WEBLN_RESPONSE', 120_000);

    // Single message listener for all channels
    window.addEventListener('message', async (event: MessageEvent) => {
        if (event.source !== window) return;

        // Route responses to the correct channel
        wot.handleResponse(event);
        nip07.handleResponse(event);
        webln.handleResponse(event);

        // Account changed notification from background
        if (event.data?.type === 'NOSTR_ACCOUNT_CHANGED') {
            window.dispatchEvent(new CustomEvent('nostr:accountChanged', {
                detail: { pubkey: event.data.pubkey }
            }));
            return;
        }

        // Handle requests from content script to get nostr pubkey
        if (event.data?.type === 'WOT_GET_NOSTR_PUBKEY') {
            let pubkey: string | null = null;
            let error: string | null = null;
            try {
                if (window.nostr && typeof window.nostr.getPublicKey === 'function') {
                    pubkey = await window.nostr.getPublicKey();
                }
            } catch (e: unknown) {
                error = (e as Error).message;
            }
            window.postMessage({
                type: 'WOT_NOSTR_PUBKEY_RESULT',
                pubkey,
                error
            }, window.location.origin);
        }
    });

    // ── Expose APIs ──

    window.nostr = window.nostr || {} as NostrProvider;

    // WoT API (always set)
    window.nostr.wot = {
        getRelayList: (pubkey) => wot.call('getRelayList', { pubkey }) as Promise<RelayListEntry[] | null>,
        getRelayPool: () => wot.call('getRelayPool', {}) as Promise<RelayPoolEntry[]>,
    };

    // NIP-07 signer methods
    window.nostr.getPublicKey = () => nip07.call('getPublicKey', {}) as Promise<string>;

    window.nostr.signEvent = (event) => nip07.call('signEvent', { event }) as Promise<SignedEvent>;

    window.nostr.getRelays = () => nip07.call('getRelays', {}) as Promise<Record<string, { read: boolean; write: boolean }>>;

    window.nostr.nip04 = {
        encrypt: (pubkey, plaintext) => nip07.call('nip04Encrypt', { pubkey, plaintext }) as Promise<string>,
        decrypt: (pubkey, ciphertext) => nip07.call('nip04Decrypt', { pubkey, ciphertext }) as Promise<string>
    };

    window.nostr.nip44 = {
        encrypt: (pubkey, plaintext) => nip07.call('nip44Encrypt', { pubkey, plaintext }) as Promise<string>,
        decrypt: (pubkey, ciphertext) => nip07.call('nip44Decrypt', { pubkey, ciphertext }) as Promise<string>
    };

    // WebLN Lightning wallet API
    let weblnEnabled = false;

    window.webln = {
        enabled: false,
        async enable() {
            await webln.call('enable', {});
            weblnEnabled = true;
            window.webln!.enabled = true;
        },
        getInfo: () => webln.call('getInfo', {}) as Promise<{ node: { alias: string; pubkey: string } }>,
        sendPayment: (paymentRequest: string) => {
            if (!weblnEnabled) return Promise.reject(new Error('WebLN not enabled. Call webln.enable() first.'));
            return webln.call('sendPayment', { paymentRequest }) as Promise<{ preimage: string }>;
        },
        makeInvoice: (args: { amount: number; defaultMemo?: string }) => {
            if (!weblnEnabled) return Promise.reject(new Error('WebLN not enabled. Call webln.enable() first.'));
            return webln.call('makeInvoice', args) as Promise<{ paymentRequest: string }>;
        },
        getBalance: () => {
            if (!weblnEnabled) return Promise.reject(new Error('WebLN not enabled. Call webln.enable() first.'));
            return webln.call('getBalance', {}) as Promise<{ balance: number }>;
        },
    };

    window.dispatchEvent(new CustomEvent('webln-ready'));

    // Notify page that APIs are ready
    window.dispatchEvent(new CustomEvent('nostr-wot-ready'));
})();
