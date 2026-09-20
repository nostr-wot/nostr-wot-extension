/**
 * inject.ts — Page-context script exposing window.nostr (NIP-07) and window.webln
 *
 * Runs in MAIN world (page context). No runtime imports; Vite inlines timeout constants.
 * All NIP-07 and WebLN methods are thin message-passing wrappers — no crypto happens here.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/07.md — NIP-07: window.nostr capability for web browsers
 */

import type { WotApi } from './src/domain/wot/types.ts';

export {}; // make this a module for declare global

// Replaced by Vite from src/constants/signing.ts; never browser globals.
declare const __NIP07_CALL_TIMEOUT_MS__: number;
declare const __WEBLN_CALL_TIMEOUT_MS__: number;

interface PendingEntry {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
}

interface NostrNip04 {
    encrypt: (pubkey: string, plaintext: string) => Promise<string>;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
}

/** Opt-in post-quantum encryption. Omit for classic NIP-44 — the signature is additive. */
interface PqEncryptOptions {
    scheme: 'pq';
    /** Recipient's ML-KEM-1024 key, base64, from their kind:10203 attestation. */
    recipientKemKey: string;
}

interface NostrNip44 {
    /**
     * Encryption schemes this signer accepts. `'pq'` here is the only way a
     * caller can know post-quantum is supported, since it rides an optional
     * third argument to `encrypt` and is otherwise undetectable.
     */
    schemes: readonly string[];
    encrypt: (pubkey: string, plaintext: string, opts?: PqEncryptOptions) => Promise<string>;
    /** No options: the payload is self-describing, so the signer routes it. */
    decrypt: (pubkey: string, ciphertext: string) => Promise<string>;
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

interface WebLNInfo {
    node: { alias: string; pubkey: string };
    supports: string[];
    methods: string[];
}

type InvoiceArgs = number | string | { amount: number | string; defaultMemo?: string };

interface WebLNProvider {
    enabled: boolean;
    enable(): Promise<void>;
    getInfo(): Promise<WebLNInfo>;
    sendPayment(paymentRequest: string): Promise<{ preimage: string }>;
    makeInvoice(args: InvoiceArgs): Promise<{ paymentRequest: string }>;
    getBalance(): Promise<{ balance: number }>;
}

interface NostrProvider {
    wot?: WotApi;
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
    // Eliminates duplication across NIP-07 and WebLN pending maps and call functions.

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

    const wot = createChannel('WOT_REQUEST', 'WOT_RESPONSE', __NIP07_CALL_TIMEOUT_MS__);
    const nip07 = createChannel('NIP07_REQUEST', 'NIP07_RESPONSE', __NIP07_CALL_TIMEOUT_MS__);
    const webln = createChannel('WEBLN_REQUEST', 'WEBLN_RESPONSE', __WEBLN_CALL_TIMEOUT_MS__);

    // Single message listener for all channels
    window.addEventListener('message', async (event: MessageEvent) => {
        if (event.source !== window) return;

        // Route responses to the correct channel
        if(event.data?.type === 'WOT_AVAILABILITY') {
            if(event.data.enabled === true) window.nostr.wot = wotApi;
            else if(window.nostr.wot === wotApi) delete window.nostr.wot;
            window.dispatchEvent(new CustomEvent('nostr:wotChanged',{detail:{enabled:event.data.enabled === true}}));
            return;
        }
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
    });

    // ── Expose APIs ──

    window.nostr = window.nostr || {} as NostrProvider;

    const wotApi: WotApi = {
        getDistance: target => wot.call('getDistance',{target}) as Promise<number|null>,
        isInMyWoT: (target,maxHops) => wot.call('isInMyWoT',{target,maxHops}) as Promise<boolean>,
        getTrustScore: target => wot.call('getTrustScore',{target}) as Promise<number|null>,
        getDetails: target => wot.call('getDetails',{target}) as ReturnType<WotApi['getDetails']>,
        getConfig: () => wot.call('getConfig',{}),
        getDistanceBatch: (targets,options) => wot.call('getDistanceBatch',{targets,...(typeof options==='boolean'?{includePaths:options}:options||{})}),
        getTrustScoreBatch: targets => wot.call('getTrustScoreBatch',{targets}) as Promise<Record<string,number|null>>,
        filterByWoT: (pubkeys,maxHops) => wot.call('filterByWoT',{pubkeys,maxHops}) as Promise<string[]>,
        getStatus: () => wot.call('getStatus',{}),
        getFollows: pubkey => wot.call('getFollows',{pubkey}) as Promise<string[]>,
        getCommonFollows: pubkey => wot.call('getCommonFollows',{pubkey}) as Promise<string[]>,
        getStats: () => wot.call('getStats',{}),
        getPath: target => wot.call('getPath',{target}) as Promise<string[]|null>,
        getRelayList: pubkey => wot.call('getRelayList',{pubkey}),
        getRelayPool: () => wot.call('getRelayPool',{}),
    };
    window.postMessage({type:'WOT_DISCOVER'},window.location.origin);

    // NIP-07 signer methods
    window.nostr.getPublicKey = () => nip07.call('getPublicKey', {}) as Promise<string>;

    window.nostr.signEvent = (event) => nip07.call('signEvent', { event }) as Promise<SignedEvent>;

    window.nostr.getRelays = () => nip07.call('getRelays', {}) as Promise<Record<string, { read: boolean; write: boolean }>>;

    window.nostr.nip04 = {
        encrypt: (pubkey, plaintext) => nip07.call('nip04Encrypt', { pubkey, plaintext }) as Promise<string>,
        decrypt: (pubkey, ciphertext) => nip07.call('nip04Decrypt', { pubkey, ciphertext }) as Promise<string>
    };

    window.nostr.nip44 = {
        // Which encryption schemes this signer accepts, so a caller can ask instead
        // of guessing. Post-quantum is an *optional third argument* to `encrypt`, so
        // a signer that supports it and one that has never heard of it are shaped
        // identically — an unaware signer would ignore the argument and hand back
        // classic ciphertext, which the caller would then present as post-quantum.
        // That silent downgrade is the exact failure this scheme exists to prevent,
        // so callers must be able to detect support rather than infer it.
        schemes: ['nip44', 'pq'],
        // `opts` is optional and additive: existing two-argument callers are untouched.
        // Pass { scheme: 'pq', recipientKemKey } to encrypt post-quantum. Decrypt takes
        // no flag — the payload is self-describing, so the signer routes it.
        encrypt: (pubkey, plaintext, opts) =>
            nip07.call('nip44Encrypt', opts ? { pubkey, plaintext, opts } : { pubkey, plaintext }) as Promise<string>,
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
        getInfo: () => webln.call('getInfo', {}) as Promise<WebLNInfo>,
        sendPayment: (paymentRequest: string) => {
            if (!weblnEnabled) return Promise.reject(new Error('WebLN not enabled. Call webln.enable() first.'));
            return webln.call('sendPayment', { paymentRequest }) as Promise<{ preimage: string }>;
        },
        makeInvoice: (args: InvoiceArgs) => {
            if (!weblnEnabled) return Promise.reject(new Error('WebLN not enabled. Call webln.enable() first.'));
            const options = typeof args === 'number' || typeof args === 'string' ? { amount: args } : args;
            const raw = options?.amount;
            const amount = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
            if (!Number.isSafeInteger(amount) || amount <= 0) {
                return Promise.reject(new Error('Invoice amount must be a positive whole number of sats.'));
            }
            return webln.call('makeInvoice', { amount, defaultMemo: options?.defaultMemo }) as Promise<{ paymentRequest: string }>;
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
