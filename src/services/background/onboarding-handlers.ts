import type { PasskeyInput } from '@domain/vault/passkey.ts';
import { MAX_ACCOUNT_NAME_LENGTH } from '@constants/accounts.ts';
import { NIP46_RELAYS } from '@constants/relays.ts';
import {
  NC_TTL_MS,
  NC_SESSIONS_KEY,
  NC_SECRETS_KEY,
  ONBOARDING_PENDING_TTL_MS as ONBOARDING_TTL_MS,
  PENDING_KEYS,
} from '@constants/wizard.ts';
/**
 * Onboarding and NostrConnect session handlers.
 * @module services/background/onboarding-handlers
 */

import browser from '../../lib/browser.ts';
import * as vault from '../vault/vault.ts';
import * as accounts from '../../domain/accounts/creation.ts';
import { npubEncode } from '../../lib/crypto/bech32.ts';
import { bytesToHex, hexToBytes, randomBytes, randomHex } from '../../lib/crypto/utils.ts';
import { getPublicKey } from '../../lib/crypto/secp256k1.ts';
import { ncryptsecEncode, ncryptsecDecode } from '../../lib/crypto/nip49.ts';
import { BunkerSigner, createNostrConnectURI, parseBunkerInput } from 'nostr-tools/nip46';
import { config, type HandlerFn, type LocalAccountEntry } from './state.ts';
import { syncActivePubkey } from './vault-handlers.ts';
import { broadcastAccountChanged } from './domain-handlers.ts';
import * as signerApprovalQueue from '../signing/approvalQueue.ts';
import { toSafeAccount } from '../../domain/accounts/account.ts';
import type { Account } from '../../domain/accounts/types.ts';
import { resolveRemoteAccount } from '../signing/remoteAccount.ts';
import { Nip46Connection } from '../signing/nip46Connection.ts';
import { AsyncLock } from '../../utils/asyncLock.ts';

// ── NostrConnect sessions ──

interface NostrConnectSession {
    signerPromise: Promise<BunkerSigner>;
    signer: BunkerSigner | null;
    account?: Account;
    secretKey: Uint8Array;
    localPubkey: string;
    relays: string[];
    error: Error | null;
    abortController: AbortController;
    connection: Nip46Connection;
    expiryTimer: ReturnType<typeof setTimeout> | null;
}
const _nostrConnectSessions = new Map<string, NostrConnectSession>();
const nostrConnectLock = new AsyncLock();

function disposeNostrConnectSession(sessionId: string): void {
    const session = _nostrConnectSessions.get(sessionId);
    if (!session) return;
    _nostrConnectSessions.delete(sessionId);
    if (session.expiryTimer) clearTimeout(session.expiryTimer);
    session.abortController.abort();
    session.connection.dispose();
    session.secretKey.fill(0);
}

// ── NIP-46 nip46 dependency injection (for tests) ──
//
// BunkerSigner.fromURI opens real relay connections, so tests override these.
// Production code uses the real nostr-tools/nip46 implementations.
interface Nip46Deps {
    BunkerSigner: typeof BunkerSigner;
    createNostrConnectURI: typeof createNostrConnectURI;
}
let _nip46Deps: Nip46Deps = { BunkerSigner, createNostrConnectURI };
/** Test seam: override the nip46 implementations. Pass no args to reset. */
export function __setNip46Deps(deps?: Partial<Nip46Deps>): void {
    _nip46Deps = {
        BunkerSigner: deps?.BunkerSigner ?? BunkerSigner,
        createNostrConnectURI: deps?.createNostrConnectURI ?? createNostrConnectURI,
    };
}

/**
 * Test seam: drop the in-memory live-session Map and pending-onboarding memory
 * while closing its transports, simulating destruction of the old worker.
 * The persisted mirror survives. After this,
 * `ensureLiveSession` / `getPendingOnboardingAccount` must rebuild from storage.
 */
export function __simulateServiceWorkerRestart(): void {
    for (const sessionId of _nostrConnectSessions.keys()) disposeNostrConnectSession(sessionId);
    _pendingOnboardingAccount = null;
    _pendingOnboardingSetAt = 0;
    if (_pendingOnboardingTimer) { clearTimeout(_pendingOnboardingTimer); _pendingOnboardingTimer = null; }
}

// ── Persisted (serializable) NostrConnect session mirror ──
//
// The live BunkerSigner + relay subscription + AbortController held in
// `_nostrConnectSessions` are lost when the MV3 service worker suspends while
// the user is scanning the QR with their wallet app. To survive suspension we
// persist the RECONSTRUCTABLE inputs to browser.storage.session and rebuild the
// live signer on demand via `ensureLiveSession()`.
//
// S-6: `secretKeyHex` is never stored as plaintext. It is XOR-split across two
// session-storage halves (pad + masked) exactly like setPendingOnboardingAccount
// does for privkeys, so neither half alone reveals the ephemeral secret.

interface PersistedNcSession {
    sessionId: string;
    secretKeyHex: string;
    localPubkey: string;
    relays: string[];
    nostrconnectUri: string;
    status: 'waiting' | 'connected' | 'error';
    errorMessage?: string;
    signerPubkey?: string;
    createdAt: number;
}

/** On-disk shape: persisted mirrors keyed by sessionId, with secretKeyHex redacted. */
type StoredNcSession = Omit<PersistedNcSession, 'secretKeyHex'>;
/** S-6 split halves keyed by sessionId. */
interface NcSecretSplit { pad: string; masked: string; }

async function loadNcSession(sessionId: string): Promise<PersistedNcSession | null> {
    const data = await browser.storage.session.get([NC_SESSIONS_KEY, NC_SECRETS_KEY]) as Record<string, unknown>;
    const sessions = (data[NC_SESSIONS_KEY] as Record<string, StoredNcSession>) || {};
    const stored = sessions[sessionId];
    if (!stored) return null;
    const secrets = (data[NC_SECRETS_KEY] as Record<string, NcSecretSplit>) || {};
    const split = secrets[sessionId];
    let secretKeyHex = '';
    if (split) {
        // S-6: reconstruct the ephemeral secret from the XOR-split halves
        const pad = hexToBytes(split.pad);
        const masked = hexToBytes(split.masked);
        const secretBytes = xorBytes(pad, masked);
        secretKeyHex = bytesToHex(secretBytes);
        secretBytes.fill(0);
        pad.fill(0);
        masked.fill(0);
    }
    return { ...stored, secretKeyHex };
}

async function saveNcSession(session: PersistedNcSession): Promise<void> {
    const data = await browser.storage.session.get([NC_SESSIONS_KEY, NC_SECRETS_KEY]) as Record<string, unknown>;
    const sessions = (data[NC_SESSIONS_KEY] as Record<string, StoredNcSession>) || {};
    const secrets = (data[NC_SECRETS_KEY] as Record<string, NcSecretSplit>) || {};

    const { secretKeyHex, ...redacted } = session;
    sessions[session.sessionId] = redacted;

    // S-6: split the ephemeral secret across two halves via XOR
    const secretBytes = hexToBytes(secretKeyHex);
    const pad = crypto.getRandomValues(new Uint8Array(secretBytes.length));
    const masked = xorBytes(secretBytes, pad);
    secretBytes.fill(0);
    secrets[session.sessionId] = { pad: bytesToHex(pad), masked: bytesToHex(masked) };
    pad.fill(0);
    masked.fill(0);

    await browser.storage.session.set({ [NC_SESSIONS_KEY]: sessions, [NC_SECRETS_KEY]: secrets });
}

async function deleteNcSession(sessionId: string): Promise<void> {
    const data = await browser.storage.session.get([NC_SESSIONS_KEY, NC_SECRETS_KEY]) as Record<string, unknown>;
    const sessions = (data[NC_SESSIONS_KEY] as Record<string, StoredNcSession>) || {};
    const secrets = (data[NC_SECRETS_KEY] as Record<string, NcSecretSplit>) || {};
    delete sessions[sessionId];
    delete secrets[sessionId];
    await browser.storage.session.set({ [NC_SESSIONS_KEY]: sessions, [NC_SECRETS_KEY]: secrets });
}

async function loadAllNcSessions(): Promise<StoredNcSession[]> {
    const data = await browser.storage.session.get([NC_SESSIONS_KEY]) as Record<string, unknown>;
    const sessions = (data[NC_SESSIONS_KEY] as Record<string, StoredNcSession>) || {};
    return Object.values(sessions);
}

/**
 * Update only the status fields of a persisted mirror (leaves the secret split
 * untouched). No-op if the mirror is gone (e.g. cancelled).
 */
async function updateNcSessionStatus(
    sessionId: string,
    patch: Partial<Pick<PersistedNcSession, 'status' | 'errorMessage' | 'signerPubkey'>>
): Promise<void> {
    const data = await browser.storage.session.get([NC_SESSIONS_KEY]) as Record<string, unknown>;
    const sessions = (data[NC_SESSIONS_KEY] as Record<string, StoredNcSession>) || {};
    const stored = sessions[sessionId];
    if (!stored) return;
    sessions[sessionId] = { ...stored, ...patch };
    await browser.storage.session.set({ [NC_SESSIONS_KEY]: sessions });
}

/**
 * Return the in-memory live session for a persisted mirror, rebuilding it (and
 * the live BunkerSigner) if the service worker was suspended and the Map was lost.
 */
function ensureLiveSession(persisted: PersistedNcSession): NostrConnectSession {
    const existing = _nostrConnectSessions.get(persisted.sessionId);
    if (existing) return existing;

    const secretKey = hexToBytes(persisted.secretKeyHex);
    const abortController = new AbortController();
    const connection = new Nip46Connection();
    const session: NostrConnectSession = {
        signerPromise: null!, signer: null, secretKey,
        localPubkey: persisted.localPubkey, relays: persisted.relays,
        error: null, abortController, connection, expiryTimer: null,
    };
    _nostrConnectSessions.set(persisted.sessionId, session);
    const expire = () => {
        // Stop network activity immediately, even if a storage operation owns the lock.
        disposeNostrConnectSession(persisted.sessionId);
        void nostrConnectLock.run(() => deleteNcSession(persisted.sessionId)).catch(() => {});
    };
    session.expiryTimer = setTimeout(expire, Math.max(0, persisted.createdAt + NC_TTL_MS - Date.now()));
    if (typeof session.expiryTimer === 'object' && 'unref' in session.expiryTimer) session.expiryTimer.unref();
    session.signerPromise = Promise.resolve().then(() => {
        if (abortController.signal.aborted) throw new Error('Nostr Connect cancelled');
        return _nip46Deps.BunkerSigner.fromURI(secretKey, persisted.nostrconnectUri, {
            pool: connection.pool,
            onauth(url: string) {
                if (!abortController.signal.aborted && url.startsWith('https://')) void browser.tabs.create({ url });
            },
        }, abortController.signal);
    });
    void session.signerPromise.then(async signer => {
        connection.attach(signer);
        const account = await resolveRemoteAccount(signer, secretKey);
        if (abortController.signal.aborted) return;
        await nostrConnectLock.run(async () => {
            if (_nostrConnectSessions.get(persisted.sessionId) !== session) return;
            session.account = account;
            session.signer = signer;
            await updateNcSessionStatus(persisted.sessionId, { status: 'connected', signerPubkey: signer.bp.pubkey });
        });
    }).catch(async err => {
        if (abortController.signal.aborted) return;
        await nostrConnectLock.run(async () => {
            if (_nostrConnectSessions.get(persisted.sessionId) !== session) return;
            session.error = err;
            await updateNcSessionStatus(persisted.sessionId, { status: 'error', errorMessage: err?.message || String(err) });
        });
    }).finally(() => {
        connection.dispose();
        secretKey.fill(0);
    }).catch(() => { /* A failed storage write must not escape the session cleanup. */ });
    return session;
}

// ── Pending onboarding account ──

let _pendingOnboardingAccount: Account | null = null;
let _pendingOnboardingSetAt = 0;
let _pendingOnboardingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * XOR two equal-length Uint8Arrays and return the result.
 */
function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
    return out;
}

/** The secret fields of an Account. Extracted together so none can be forgotten. */
interface PendingSecrets {
    privkey: string | null;
    mnemonic: string | null;
    localPrivkey: string | null;
}

async function setPendingOnboardingAccount(acct: Account | null): Promise<void> {
    _pendingOnboardingAccount = acct;
    _pendingOnboardingSetAt = acct ? Date.now() : 0;
    if (_pendingOnboardingTimer) { clearTimeout(_pendingOnboardingTimer); _pendingOnboardingTimer = null; }
    if (acct) {
        // Persist createdAt alongside the redacted account: the in-memory
        // setTimeout is lost on service-worker restart, so the TTL must also
        // be enforceable on read (see getPendingOnboardingAccount).
        const createdAt = _pendingOnboardingSetAt;

        // S-6: split EVERY secret across two session-storage keys via XOR, so neither
        // key alone reveals anything. This used to cover the privkey only, which left
        // the mnemonic — strictly the more valuable secret, since it restores every
        // derived account — sitting in the clear beside it. That matters most on
        // Safari, where storage.session is shimmed onto storage.local (lib/browser.ts)
        // and therefore lands on disk.
        const secrets: PendingSecrets = {
            privkey: acct.privkey ?? null,
            mnemonic: acct.mnemonic ?? null,
            localPrivkey: acct.nip46Config?.localPrivkey ?? null,
        };
        const redacted: Account = {
            ...acct,
            privkey: null,
            mnemonic: null,
            nip46Config: acct.nip46Config
                ? { ...acct.nip46Config, localPrivkey: undefined }
                : acct.nip46Config,
        };

        if (secrets.privkey || secrets.mnemonic || secrets.localPrivkey) {
            const plain = new TextEncoder().encode(JSON.stringify(secrets));
            const pad = crypto.getRandomValues(new Uint8Array(plain.length));
            const masked = xorBytes(plain, pad);
            plain.fill(0);

            await browser.storage.session.set({
                _pendingOnboardingAccount: redacted,
                _pendingOnboardingCreatedAt: createdAt,
                _pendingOnboardingSecretsPad: bytesToHex(pad),
                _pendingOnboardingSecrets: bytesToHex(masked),
            });
            pad.fill(0);
            masked.fill(0);
            await browser.storage.session.remove(['_pendingOnboardingPad', '_pendingOnboardingMasked']);
        } else {
            await browser.storage.session.set({
                _pendingOnboardingAccount: redacted,
                _pendingOnboardingCreatedAt: createdAt,
            });
            await browser.storage.session.remove([
                '_pendingOnboardingSecrets', '_pendingOnboardingSecretsPad',
                '_pendingOnboardingPad', '_pendingOnboardingMasked',
            ]);
        }
        _pendingOnboardingTimer = setTimeout(() => setPendingOnboardingAccount(null), ONBOARDING_TTL_MS);
        // Don't keep the Node.js process alive for the full 5-minute TTL (matters in
        // tests, where an un-cleared pending account otherwise holds the runner open
        // until the timer fires — the same reason vault.ts unrefs its auto-lock timer).
        // No-op in the browser, where timers have no unref.
        if (typeof _pendingOnboardingTimer === 'object' && 'unref' in _pendingOnboardingTimer) {
            (_pendingOnboardingTimer as NodeJS.Timeout).unref();
        }
    } else {
        await browser.storage.session.remove(PENDING_KEYS);
    }
}

/**
 * Drop an expired pending-onboarding record left in session storage.
 *
 * The TTL is enforced on read, which is enough on Chrome — but on Safari
 * storage.session is storage.local, so an onboarding the user simply abandoned would
 * otherwise keep its record on disk until something happened to read it, which may be
 * never. Called on background startup; a still-valid record is left alone, because on
 * Chrome the service worker restarts constantly inside a live onboarding.
 */
export async function cleanupExpiredPendingOnboarding(): Promise<void> {
    const data = await browser.storage.session.get([
        '_pendingOnboardingAccount',
        '_pendingOnboardingCreatedAt',
    ]) as Record<string, unknown>;
    if (!data._pendingOnboardingAccount && !data._pendingOnboardingCreatedAt) return;
    const createdAt = data._pendingOnboardingCreatedAt as number | undefined;
    if (!createdAt || Date.now() - createdAt >= ONBOARDING_TTL_MS) {
        await browser.storage.session.remove(PENDING_KEYS);
    }
}

async function getPendingOnboardingAccount(): Promise<Account | null> {
    if (_pendingOnboardingAccount) {
        // Enforce the TTL even if the in-memory timer was throttled or lost.
        if (Date.now() - _pendingOnboardingSetAt >= ONBOARDING_TTL_MS) {
            await setPendingOnboardingAccount(null);
            return null;
        }
        return _pendingOnboardingAccount;
    }
    const data = await browser.storage.session.get(PENDING_KEYS) as Record<string, unknown>;
    const stored = data._pendingOnboardingAccount as Account | null;
    if (!stored) return null;

    // The in-memory setTimeout dies with the service worker — enforce the TTL
    // on read. Missing createdAt (pre-upgrade data) is treated as expired.
    const createdAt = data._pendingOnboardingCreatedAt as number | undefined;
    if (!createdAt || Date.now() - createdAt >= ONBOARDING_TTL_MS) {
        await setPendingOnboardingAccount(null);
        return null;
    }

    // A record written by an older build split the privkey only, and stored the
    // mnemonic in the clear. Rather than read that shape back, treat it as expired:
    // the record is at most five minutes of onboarding, and re-entering it is a far
    // better outcome than resurrecting a format we just stopped trusting.
    if (data._pendingOnboardingPad || data._pendingOnboardingMasked) {
        await setPendingOnboardingAccount(null);
        return null;
    }

    // S-6: reconstruct every secret from the XOR-split halves.
    const padHex = data._pendingOnboardingSecretsPad as string | undefined;
    const maskedHex = data._pendingOnboardingSecrets as string | undefined;
    if (padHex && maskedHex) {
        const pad = hexToBytes(padHex);
        const masked = hexToBytes(maskedHex);
        const plain = xorBytes(pad, masked);
        try {
            const secrets = JSON.parse(new TextDecoder().decode(plain)) as PendingSecrets;
            if (secrets.privkey) stored.privkey = secrets.privkey;
            if (secrets.mnemonic) stored.mnemonic = secrets.mnemonic;
            if (secrets.localPrivkey && stored.nip46Config) {
                stored.nip46Config.localPrivkey = secrets.localPrivkey;
            }
        } catch {
            // A corrupt blob means the record cannot be trusted — drop it.
            await setPendingOnboardingAccount(null);
            return null;
        } finally {
            plain.fill(0);
            pad.fill(0);
            masked.fill(0);
        }
    }
    return stored;
}

export async function checkDuplicateAccount(pubkey: string): Promise<{ upgradeFromReadOnly: string | null }> {
    const localAccts = ((await browser.storage.local.get(['accounts'])) as Record<string, Array<{ pubkey: string; id: string }>>).accounts || [];
    const existing = localAccts.find(a => a.pubkey === pubkey);
    if (existing && await vault.exists() && !vault.isLocked()) {
        const hasEncryptedKey = vault.listAccounts().some(a => a.pubkey === pubkey && !a.readOnly);
        if (hasEncryptedKey) {
            throw new Error('This account is already added with full signing access.');
        }
        return { upgradeFromReadOnly: existing.id };
    }
    return { upgradeFromReadOnly: null };
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['onboarding_validateNsec', async (params) => {
        const acct = await accounts.importNsec(params.input as string);
        const safeAcct = toSafeAccount(acct);
        const dup = await checkDuplicateAccount(acct.pubkey);
        await setPendingOnboardingAccount(acct);
        return {
            account: safeAcct,
            pubkey: acct.pubkey,
            npub: npubEncode(acct.pubkey),
            upgradeFromReadOnly: dup.upgradeFromReadOnly
        };
    }],

    ['onboarding_validateNcryptsec', async (params) => {
        const privkeyHex = await ncryptsecDecode(params.ncryptsec as string, params.password as string);
        const acct = await accounts.importNsec(privkeyHex, params.name as string);
        const safeAcct = toSafeAccount(acct);
        const dup = await checkDuplicateAccount(acct.pubkey);
        await setPendingOnboardingAccount(acct);
        return {
            account: safeAcct,
            pubkey: acct.pubkey,
            npub: npubEncode(acct.pubkey),
            upgradeFromReadOnly: dup.upgradeFromReadOnly
        };
    }],

    ['onboarding_validateMnemonic', async (params) => {
        const mnemonic = (params.mnemonic as string).trim().toLowerCase().replace(/\s+/g, ' ');
        let hasSeed = false;
        if (await vault.exists() && !vault.isLocked()) {
            try {
                const payload = vault.getDecryptedPayload();
                hasSeed = payload.accounts.some(a => a.type === 'generated' && a.mnemonic);
            } catch { /* ignore */ }
        }
        const acct = hasSeed
            ? await accounts.importFromMnemonicDerived(mnemonic)
            : await accounts.createFromMnemonic(mnemonic, 'Imported');
        const safeAcct = toSafeAccount(acct);
        const dup = await checkDuplicateAccount(acct.pubkey);
        await setPendingOnboardingAccount(acct);
        return {
            account: safeAcct,
            pubkey: acct.pubkey,
            npub: npubEncode(acct.pubkey),
            upgradeFromReadOnly: dup.upgradeFromReadOnly,
            importedAsMain: !hasSeed,
        };
    }],

    ['onboarding_validateNpub', async (params) => {
        const acct = accounts.importNpub(params.input as string);
        return { account: toSafeAccount(acct), pubkey: acct.pubkey };
    }],

    ['onboarding_connectNip46', async (params) => {
        const input = (params.bunkerUrl as string).trim();
        if (!input.startsWith('bunker://')) throw new Error('Invalid bunker URL');
        const pointer = await parseBunkerInput(input);
        if (!pointer || !pointer.relays.length) throw new Error('Invalid bunker URL: missing relay');
        const secretKey = randomBytes(32);
        const connection = new Nip46Connection();
        try {
            const signer = connection.attach(_nip46Deps.BunkerSigner.fromBunker(secretKey, pointer, {
                pool: connection.pool,
                onauth(url: string) {
                    if (url.startsWith('https://')) void browser.tabs.create({ url });
                },
            }));
            const acct = await resolveRemoteAccount(signer, secretKey, true);
            await setPendingOnboardingAccount(acct);
            return { account: toSafeAccount(acct) };
        } finally { connection.dispose(); secretKey.fill(0); }
    }],

    ['onboarding_initNostrConnect', async () => nostrConnectLock.run(async () => {
        // Resume a still-valid waiting session instead of orphaning it. The popup
        // re-inits on mount (e.g. after the SW suspended during a QR scan); if a
        // 'waiting' mirror is still alive, rebuild its live signer and hand back
        // the SAME uri/sessionId so the QR the user is scanning stays valid.
        const stored = await loadAllNcSessions();
        const now = Date.now();
        const resumable = stored.find(s => s.status === 'waiting' && (now - s.createdAt) < NC_TTL_MS);
        if (resumable) {
            const persisted = await loadNcSession(resumable.sessionId);
            if (persisted) {
                ensureLiveSession(persisted);
                return { nostrconnectUri: persisted.nostrconnectUri, sessionId: persisted.sessionId };
            }
        }

        // Clean up existing sessions (live + persisted mirrors)
        for (const oldId of _nostrConnectSessions.keys()) disposeNostrConnectSession(oldId);
        for (const s of stored) {
            await deleteNcSession(s.sessionId);
        }

        const connectSecret = randomHex(16);
        const ncSecretKey = randomBytes(32);
        const ncLocalPubkey = bytesToHex(getPublicKey(ncSecretKey));

        const nostrconnectUri = _nip46Deps.createNostrConnectURI({
            clientPubkey: ncLocalPubkey,
            relays: NIP46_RELAYS,
            secret: connectSecret,
            name: 'Nostr WoT',
            url: 'https://nostr-wot.com',
            image: 'https://nostr-wot.com/icon-512.png'
        });

        const sessionId = randomHex(8);

        // Persist the reconstructable inputs BEFORE building the live signer so
        // a suspension mid-build can still be resumed.
        await saveNcSession({
            sessionId,
            secretKeyHex: bytesToHex(ncSecretKey),
            localPubkey: ncLocalPubkey,
            relays: NIP46_RELAYS,
            nostrconnectUri,
            status: 'waiting',
            createdAt: Date.now(),
        });

        ensureLiveSession({ sessionId, secretKeyHex: bytesToHex(ncSecretKey), localPubkey: ncLocalPubkey, relays: NIP46_RELAYS, nostrconnectUri, status: 'waiting', createdAt: now });
        ncSecretKey.fill(0);
        return { nostrconnectUri, sessionId };
    })],

    ['onboarding_pollNostrConnect', async (params) => nostrConnectLock.run(async () => {
        const sessionId = params.sessionId as string;
        const persisted = await loadNcSession(sessionId);
        if (!persisted) { disposeNostrConnectSession(sessionId); return { expired: true }; }

        if (Date.now() - persisted.createdAt >= NC_TTL_MS) {
            disposeNostrConnectSession(sessionId);
            await deleteNcSession(sessionId);
            return { expired: true };
        }

        // A previous poll (or the .catch wiring) already recorded a fatal error.
        if (persisted.status === 'error') {
            disposeNostrConnectSession(sessionId);
            await deleteNcSession(sessionId);
            return { error: persisted.errorMessage || 'Connection failed' };
        }

        // Rebuild the live signer if the SW suspended and dropped the Map.
        const session = ensureLiveSession(persisted);

        if (session.signer) {
            const acct = session.account!;
            disposeNostrConnectSession(sessionId);
            await deleteNcSession(sessionId);
            await setPendingOnboardingAccount(acct);
            const safeNc = toSafeAccount(acct);
            return { connected: true, account: safeNc };
        }
        if (session.error) {
            disposeNostrConnectSession(sessionId);
            await deleteNcSession(sessionId);
            return { error: session.error.message || 'Connection failed' };
        }
        return { connected: false };
    })],

    ['onboarding_cancelNostrConnect', async (params) => nostrConnectLock.run(async () => {
        const sessionId = params.sessionId as string;
        disposeNostrConnectSession(sessionId);
        await deleteNcSession(sessionId);
        return { ok: true };
    })],

    ['onboarding_generateAccount', async (params) => {
        const { account: acct, mnemonic } = await accounts.generateNewAccount();
        const safeAcct = toSafeAccount(acct);
        await setPendingOnboardingAccount(acct);
        return params.hideMnemonic ? { account: safeAcct } : { account: safeAcct, mnemonic };
    }],

    ['onboarding_checkExistingSeed', async () => {
        if (vault.isLocked()) return { hasSeed: false };
        try {
            const payload = vault.getDecryptedPayload();
            const generated = payload.accounts.find(a => a.type === 'generated' && a.mnemonic);
            return { hasSeed: !!generated };
        } catch {
            return { hasSeed: false };
        }
    }],

    ['onboarding_generateSubAccount', async (params) => {
        await vault.requireUnlocked();
        const payload = vault.getDecryptedPayload();
        const seedAccount = payload.accounts.find(a => a.id === payload.activeAccountId && a.type === 'generated' && a.mnemonic)
            || payload.accounts.find(a => a.type === 'generated' && a.mnemonic);
        if (!seedAccount || !seedAccount.mnemonic) {
            throw new Error('No existing seed account found');
        }
        const maxIndex = payload.accounts
            .filter(a => a.type === 'generated' && a.mnemonic === seedAccount.mnemonic)
            .reduce((max, a) => Math.max(max, a.derivationIndex ?? 0), 0);
        const nextIndex = maxIndex + 1;
        const subAcct = params.derivationPath !== undefined
            ? await accounts.createFromMnemonicAtPath(seedAccount.mnemonic, params.derivationPath as string, (params.name as string) || undefined)
            : await accounts.createFromMnemonicAtIndex(seedAccount.mnemonic, nextIndex, (params.name as string) || undefined);
        if (payload.accounts.some(account => account.pubkey === subAcct.pubkey)) {
            throw new Error('An account with this derivation path already exists');
        }
        const safeSubAcct = toSafeAccount(subAcct);
        await setPendingOnboardingAccount(subAcct);
        return { account: safeSubAcct, derivationIndex: subAcct.derivationIndex, derivationPath: subAcct.derivationPath, seedName: seedAccount.name };

    }],

    ['onboarding_exportNcryptsec', async (params) => {
        const pendingAcctEnc = await getPendingOnboardingAccount();
        if (!pendingAcctEnc?.privkey) throw new Error('No pending account');
        return await ncryptsecEncode(pendingAcctEnc.privkey, params.password as string);
    }],

    ['onboarding_saveReadOnly', async (params) => {
        const acctId = (params.account as Record<string, string>).id;
        const pubkey = (params.account as Record<string, string>).pubkey;
        const acctType = (params.account as Pick<Account, 'type'>).type || 'npub';
        const prevActiveRo = ((await browser.storage.local.get(['activeAccountId'])) as Record<string, string>).activeAccountId;
        if (pubkey) {
            config.myPubkey = pubkey;
            await browser.storage.sync.set({ myPubkey: pubkey });
        }
        const localAccts = await browser.storage.local.get(['accounts']) as Record<string, LocalAccountEntry[]>;
        const accts = localAccts.accounts || [];
        if (!accts.some(a => a.id === acctId)) {
            accts.push({
                id: acctId,
                name: (params.account as Record<string, string>).name || 'Account',
                pubkey,
                type: acctType,
                readOnly: acctType !== 'nip46'
            });
        }
        await browser.storage.local.set({ accounts: accts, activeAccountId: acctId });
        // Active-account change: same invalidation as switchAccount.
        await signerApprovalQueue.onActiveAccountChanged(prevActiveRo, acctId);
        return { ok: true };
    }],

    ['onboarding_createVault', async (params) => {
        // Creating replaces the vault outright: the payload below is
        // `accounts: [fullAccount]`, so every other key in it is gone. There is
        // therefore exactly one situation in which this may run — no vault yet.
        //
        // The popup already tries to enforce that, and cannot be relied on to.
        // PasswordStep probes for an existing vault and falls into
        // `catch { setVaultExists(false) }` (PasswordStep.tsx:50-51), which turns
        // *any* failure of that probe — a cold worker, or the persisted
        // brute-force guard throwing during a lockout — into "there is no vault",
        // and the next screen offers to create one. Accepting that here would
        // destroy every stored key while telling the user we were setting their
        // security up.
        //
        // Adding an account to an existing vault is onboarding_addToVault, and
        // deliberately replacing one means vault_destroy first.
        //
        // The test is "holds accounts", not merely "exists": removing the last
        // account leaves an empty vault behind, and onboarding through that is a
        // supported flow (see tests/delete-recreate.test.ts). The account list in
        // storage.local is what makes this answerable while the vault is LOCKED,
        // which is exactly the state the dangerous path arrives in — the decrypted
        // payload is unreadable then, so asking the vault itself would answer
        // "no accounts" and wave the overwrite through.
        if (await vault.exists()) {
            const known = ((await browser.storage.local.get(['accounts'])) as Record<string, LocalAccountEntry[]>).accounts || [];
            const holdsAccounts = known.length > 0
                || (!vault.isLocked() && vault.listAccounts().length > 0);
            if (holdsAccounts) {
                throw new Error('A vault already exists on this device. Unlock it to add an account.');
            }
        }

        const prevActiveCreate = ((await browser.storage.local.get(['activeAccountId'])) as Record<string, string>).activeAccountId;
        const pendingAcct = await getPendingOnboardingAccount();
        const fullAccount = pendingAcct && pendingAcct.id === (params.account as Record<string, string>).id
            ? pendingAcct
            : params.account as Account;
        if (!fullAccount.privkey && fullAccount.type !== 'npub' && fullAccount.type !== 'nip46') {
            throw new Error('Cannot create vault: private key was lost. Please re-import your nsec.');
        }
        if (params.name !== undefined) {
            if (typeof params.name !== 'string' || params.name.trim().length > MAX_ACCOUNT_NAME_LENGTH) throw new Error('Invalid account name');
            fullAccount.name = params.name.trim() || fullAccount.name;
        }

        const payload = {
            accounts: [fullAccount],
            activeAccountId: fullAccount.id
        };
        const passkey = params.passkey as PasskeyInput | undefined;
        if (passkey && params.autoLockMinutes !== undefined && (typeof params.autoLockMinutes !== 'number' || !Number.isFinite(params.autoLockMinutes) || params.autoLockMinutes <= 0)) throw new Error('Passkey vaults require automatic locking');
        await vault.create(passkey ? '' : params.password as string, payload, passkey);
        await setPendingOnboardingAccount(null);
        if (params.autoLockMinutes !== undefined) {
            vault.setAutoLockTimeout((params.autoLockMinutes as number) * 60 * 1000);
            await browser.storage.local.set({ autoLockMs: (params.autoLockMinutes as number) * 60 * 1000 });
        }
        await syncActivePubkey();
        const vaultAcctId = fullAccount.id;
        const localAccts = await browser.storage.local.get(['accounts']) as Record<string, LocalAccountEntry[]>;
        let accts = localAccts.accounts || [];
        if (params.upgradeFromReadOnly) {
            accts = accts.filter(a => a.id !== params.upgradeFromReadOnly);
        }
        if (!accts.some(a => a.id === vaultAcctId)) {
            accts.push({
                id: vaultAcctId,
                name: fullAccount.name || 'Account',
                pubkey: fullAccount.pubkey,
                type: fullAccount.type || 'generated',
                derivationPath: fullAccount.derivationPath,
                derivationIndex: fullAccount.derivationIndex,
                readOnly: !fullAccount.privkey && fullAccount.type !== 'nip46'
            });
        } else {
            const idx = accts.findIndex(a => a.id === vaultAcctId);
            if (idx !== -1) accts[idx].readOnly = !fullAccount.privkey && fullAccount.type !== 'nip46';
        }
        await browser.storage.local.set({ accounts: accts, activeAccountId: vaultAcctId });
        // Active-account change: same invalidation as switchAccount.
        await signerApprovalQueue.onActiveAccountChanged(prevActiveCreate, vaultAcctId);
        return { ok: true };
    }],

    ['onboarding_addToVault', async (params) => {
        if (vault.isLocked()) throw new Error('Vault is locked');
        const prevActiveAdd = ((await browser.storage.local.get(['activeAccountId'])) as Record<string, string>).activeAccountId;

        const pendingAcctAdd = await getPendingOnboardingAccount();
        let fullAccountAdd = pendingAcctAdd && pendingAcctAdd.id === (params.account as Record<string, string>).id
            ? pendingAcctAdd
            : params.account as Account;
        if (params.name !== undefined) {
            if (typeof params.name !== 'string' || params.name.trim().length > MAX_ACCOUNT_NAME_LENGTH) {
                throw new Error('Invalid account name');
            }
            fullAccountAdd = { ...fullAccountAdd, name: params.name.trim() || fullAccountAdd.name };
        }
        if (!fullAccountAdd.privkey && fullAccountAdd.type !== 'npub' && fullAccountAdd.type !== 'nip46') {
            throw new Error('Cannot add account: private key was lost. Please re-import.');
        }
        await setPendingOnboardingAccount(null);

        await vault.addAccount(fullAccountAdd);
        await vault.setActiveAccount(fullAccountAdd.id);
        await syncActivePubkey();

        const addVaultLocalData = await browser.storage.local.get(['accounts']) as Record<string, LocalAccountEntry[]>;
        let addVaultAccts = addVaultLocalData.accounts || [];
        if (params.upgradeFromReadOnly) {
            addVaultAccts = addVaultAccts.filter(a => a.id !== params.upgradeFromReadOnly);
        }
        if (!addVaultAccts.some(a => a.id === fullAccountAdd.id)) {
            addVaultAccts.push({
                id: fullAccountAdd.id,
                name: fullAccountAdd.name || 'Account',
                pubkey: fullAccountAdd.pubkey,
                type: fullAccountAdd.type || 'generated',
                derivationPath: fullAccountAdd.derivationPath,
                derivationIndex: fullAccountAdd.derivationIndex,
                readOnly: !fullAccountAdd.privkey && fullAccountAdd.type !== 'nip46'
            });
        } else {
            const idx = addVaultAccts.findIndex(a => a.id === fullAccountAdd.id);
            if (idx !== -1) addVaultAccts[idx].readOnly = !fullAccountAdd.privkey && fullAccountAdd.type !== 'nip46';
        }
        await browser.storage.local.set({ accounts: addVaultAccts, activeAccountId: fullAccountAdd.id });
        // Active-account change: same invalidation as switchAccount.
        await signerApprovalQueue.onActiveAccountChanged(prevActiveAdd, fullAccountAdd.id);
        if (fullAccountAdd.pubkey) {
            void broadcastAccountChanged(fullAccountAdd.pubkey);
        }
        return { ok: true };
    }],
]);
