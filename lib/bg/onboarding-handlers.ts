/**
 * Onboarding and NostrConnect session handlers.
 * @module lib/bg/onboarding-handlers
 */

import browser from '../browser.ts';
import * as vault from '../vault.ts';
import * as accounts from '../accounts.ts';
import * as storage from '../storage.ts';
import { npubEncode } from '../crypto/bech32.ts';
import { bytesToHex, hexToBytes, randomBytes, randomHex } from '../crypto/utils.ts';
import { getPublicKey } from '../crypto/secp256k1.ts';
import { ncryptsecEncode, ncryptsecDecode } from '../crypto/nip49.ts';
import { BunkerSigner, createNostrConnectURI } from 'nostr-tools/nip46';
import { config, DEFAULT_RELAYS, resetLocalGraph, type HandlerFn, type LocalAccountEntry } from './state.ts';
import { syncActivePubkey } from './vault-handlers.ts';
import { broadcastAccountChanged, refreshBadgesOnAllTabs } from './domain-handlers.ts';
import type { Account } from '../types.ts';

// ── NostrConnect sessions ──

interface NostrConnectSession {
    signerPromise: Promise<BunkerSigner>;
    signer: BunkerSigner | null;
    secretKey: Uint8Array;
    localPubkey: string;
    relays: string[];
    error: Error | null;
    abortController: AbortController;
}
const _nostrConnectSessions = new Map<string, NostrConnectSession>();

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
 * Test seam: drop the in-memory live-session Map WITHOUT aborting/closing the
 * signers, simulating an MV3 service-worker suspension that loses RAM but keeps
 * browser.storage.session. After this, `ensureLiveSession` must rebuild.
 */
export function __simulateServiceWorkerRestart(): void {
    _nostrConnectSessions.clear();
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

const NC_TTL_MS = 5 * 60 * 1000;
const NC_SESSIONS_KEY = '_ncSessions';
const NC_SECRETS_KEY = '_ncSessionSecrets';

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
    const session: NostrConnectSession = {
        signerPromise: null!,
        signer: null,
        secretKey,
        localPubkey: persisted.localPubkey,
        relays: persisted.relays,
        error: null,
        abortController,
    };

    session.signerPromise = _nip46Deps.BunkerSigner.fromURI(
        secretKey,
        persisted.nostrconnectUri,
        { onauth(url: string) {
            if (!url.startsWith('https://')) {
                console.warn('[NIP-46] rejected non-HTTPS auth_url:', url);
                return;
            }
            browser.tabs.create({ url });
        } },
        abortController.signal
    );
    session.signerPromise
        .then(signer => {
            session.signer = signer;
            updateNcSessionStatus(persisted.sessionId, {
                status: 'connected',
                signerPubkey: signer.bp.pubkey,
            }).catch(() => {});
        })
        .catch(err => {
            session.error = err;
            updateNcSessionStatus(persisted.sessionId, {
                status: 'error',
                errorMessage: err?.message || String(err),
            }).catch(() => {});
        });

    _nostrConnectSessions.set(persisted.sessionId, session);
    return session;
}

// ── Pending onboarding account ──

let _pendingOnboardingAccount: Account | null = null;
let _pendingOnboardingTimer: ReturnType<typeof setTimeout> | null = null;
const ONBOARDING_TTL_MS = 5 * 60 * 1000;

/**
 * XOR two equal-length Uint8Arrays and return the result.
 */
function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
    return out;
}

async function setPendingOnboardingAccount(acct: Account | null): Promise<void> {
    _pendingOnboardingAccount = acct;
    if (_pendingOnboardingTimer) { clearTimeout(_pendingOnboardingTimer); _pendingOnboardingTimer = null; }
    if (acct) {
        // S-6: Split the privkey across two session storage keys via XOR so
        // neither key alone reveals the secret.
        if (acct.privkey) {
            const privkeyBytes = hexToBytes(acct.privkey);
            const pad = crypto.getRandomValues(new Uint8Array(privkeyBytes.length));
            const masked = xorBytes(privkeyBytes, pad);
            // Zero the intermediate plaintext copy
            privkeyBytes.fill(0);

            const redacted = { ...acct, privkey: null };
            await browser.storage.session.set({
                _pendingOnboardingAccount: redacted,
                _pendingOnboardingPad: bytesToHex(pad),
                _pendingOnboardingMasked: bytesToHex(masked),
            });
            pad.fill(0);
            masked.fill(0);
        } else {
            await browser.storage.session.set({ _pendingOnboardingAccount: acct });
            await browser.storage.session.remove(['_pendingOnboardingPad', '_pendingOnboardingMasked']);
        }
        _pendingOnboardingTimer = setTimeout(() => setPendingOnboardingAccount(null), ONBOARDING_TTL_MS);
    } else {
        await browser.storage.session.remove([
            '_pendingOnboardingAccount',
            '_pendingOnboardingPad',
            '_pendingOnboardingMasked',
        ]);
    }
}

async function getPendingOnboardingAccount(): Promise<Account | null> {
    if (_pendingOnboardingAccount) return _pendingOnboardingAccount;
    const data = await browser.storage.session.get([
        '_pendingOnboardingAccount',
        '_pendingOnboardingPad',
        '_pendingOnboardingMasked',
    ]) as Record<string, unknown>;
    const stored = data._pendingOnboardingAccount as Account | null;
    if (!stored) return null;

    // S-6: Reconstruct privkey from the XOR-split halves
    const padHex = data._pendingOnboardingPad as string | undefined;
    const maskedHex = data._pendingOnboardingMasked as string | undefined;
    if (padHex && maskedHex) {
        const pad = hexToBytes(padHex);
        const masked = hexToBytes(maskedHex);
        const privkeyBytes = xorBytes(pad, masked);
        stored.privkey = bytesToHex(privkeyBytes);
        privkeyBytes.fill(0);
        pad.fill(0);
        masked.fill(0);
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
        const { privkey, mnemonic, ...safeAcct } = acct;
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
        const { privkey: _pk, mnemonic: _mn, ...safeAcct } = acct;
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
        const { privkey, mnemonic: _mn, ...safeAcct } = acct;
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
        return { account: acct, pubkey: acct.pubkey };
    }],

    ['onboarding_connectNip46', async (params) => {
        const acct = accounts.connectNip46(params.bunkerUrl as string);
        await setPendingOnboardingAccount(acct);
        const { nip46Config: _n46, privkey: _pk, mnemonic: _mn, ...safeNip46 } = acct;
        return { account: safeNip46 };
    }],

    ['onboarding_initNostrConnect', async () => {
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
        for (const [oldId, oldSession] of _nostrConnectSessions) {
            oldSession.abortController.abort();
            if (oldSession.signer) oldSession.signer.close().catch(() => {});
            oldSession.secretKey.fill(0);
            _nostrConnectSessions.delete(oldId);
        }
        for (const s of stored) {
            await deleteNcSession(s.sessionId);
        }

        const NIP46_RELAYS = ['wss://relay.nsec.app', ...DEFAULT_RELAYS];
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

        const abortController = new AbortController();
        const session: NostrConnectSession = {
            signerPromise: null!,
            signer: null,
            secretKey: ncSecretKey,
            localPubkey: ncLocalPubkey,
            relays: NIP46_RELAYS,
            error: null,
            abortController,
        };

        session.signerPromise = _nip46Deps.BunkerSigner.fromURI(
            ncSecretKey,
            nostrconnectUri,
            { onauth(url: string) {
                if (!url.startsWith('https://')) {
                    console.warn('[NIP-46] rejected non-HTTPS auth_url:', url);
                    return;
                }
                browser.tabs.create({ url });
            } },
            abortController.signal
        );
        session.signerPromise
            .then(signer => {
                session.signer = signer;
                updateNcSessionStatus(sessionId, {
                    status: 'connected',
                    signerPubkey: signer.bp.pubkey,
                }).catch(() => {});
            })
            .catch(err => {
                session.error = err;
                updateNcSessionStatus(sessionId, {
                    status: 'error',
                    errorMessage: err?.message || String(err),
                }).catch(() => {});
            });

        _nostrConnectSessions.set(sessionId, session);
        return { nostrconnectUri, sessionId };
    }],

    ['onboarding_pollNostrConnect', async (params) => {
        const sessionId = params.sessionId as string;
        const persisted = await loadNcSession(sessionId);
        if (!persisted) return { expired: true };

        if (Date.now() - persisted.createdAt >= NC_TTL_MS) {
            await deleteNcSession(sessionId);
            return { expired: true };
        }

        // A previous poll (or the .catch wiring) already recorded a fatal error.
        if (persisted.status === 'error') {
            await deleteNcSession(sessionId);
            return { error: persisted.errorMessage || 'Connection failed' };
        }

        // Rebuild the live signer if the SW suspended and dropped the Map.
        const session = ensureLiveSession(persisted);

        if (session.signer) {
            const signerPk = session.signer.bp.pubkey;
            const primaryRelay = session.relays[0];
            const localPrivkeyHex = bytesToHex(session.secretKey);
            const acct = accounts.connectNostrConnect(
                signerPk, primaryRelay,
                localPrivkeyHex, session.localPubkey
            );
            _nostrConnectSessions.delete(sessionId);
            await deleteNcSession(sessionId);
            await setPendingOnboardingAccount(acct);
            const { nip46Config: _n46, privkey: _pk, mnemonic: _mn, ...safeNc } = acct;
            return { connected: true, account: safeNc };
        }
        if (session.error) {
            _nostrConnectSessions.delete(sessionId);
            await deleteNcSession(sessionId);
            return { error: session.error.message || 'Connection failed' };
        }
        return { connected: false };
    }],

    ['onboarding_cancelNostrConnect', async (params) => {
        const sessionId = params.sessionId as string;
        const session2 = _nostrConnectSessions.get(sessionId);
        if (session2) {
            session2.abortController.abort();
            if (session2.signer) session2.signer.close().catch(() => {});
            session2.secretKey.fill(0);
            _nostrConnectSessions.delete(sessionId);
        }
        await deleteNcSession(sessionId);
        return { ok: true };
    }],

    ['onboarding_generateAccount', async () => {
        const { account: acct, mnemonic } = await accounts.generateNewAccount();
        const { privkey, ...safeAcct } = acct;
        await setPendingOnboardingAccount(acct);
        return { account: safeAcct, mnemonic };
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
        if (vault.isLocked()) throw new Error('Vault is locked');
        const payload = vault.getDecryptedPayload();
        const seedAccount = payload.accounts.find(a => a.type === 'generated' && a.mnemonic);
        if (!seedAccount || !seedAccount.mnemonic) {
            throw new Error('No existing seed account found');
        }
        const maxIndex = payload.accounts
            .filter(a => a.type === 'generated' && a.mnemonic === seedAccount.mnemonic)
            .reduce((max, a) => Math.max(max, a.derivationIndex ?? 0), 0);
        const nextIndex = maxIndex + 1;
        const subAcct = await accounts.createFromMnemonicAtIndex(
            seedAccount.mnemonic,
            nextIndex,
            (params.name as string) || undefined
        );
        const { privkey: _pk, ...safeSubAcct } = subAcct;
        await setPendingOnboardingAccount(subAcct);
        return { account: safeSubAcct, derivationIndex: nextIndex };
    }],

    ['onboarding_exportNcryptsec', async (params) => {
        const pendingAcctEnc = await getPendingOnboardingAccount();
        if (!pendingAcctEnc?.privkey) throw new Error('No pending account');
        return await ncryptsecEncode(pendingAcctEnc.privkey, params.password as string);
    }],

    ['onboarding_saveReadOnly', async (params) => {
        const acctId = (params.account as Record<string, string>).id;
        const pubkey = (params.account as Record<string, string>).pubkey;
        const acctType = (params.account as Record<string, string>).type || 'npub';
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
        await storage.switchDatabase(acctId);
        resetLocalGraph();
        return { ok: true };
    }],

    ['onboarding_createVault', async (params) => {
        const pendingAcct = await getPendingOnboardingAccount();
        const fullAccount = pendingAcct && pendingAcct.id === (params.account as Record<string, string>).id
            ? pendingAcct
            : params.account as Account;
        if (!fullAccount.privkey && fullAccount.type !== 'npub' && fullAccount.type !== 'nip46') {
            throw new Error('Cannot create vault: private key was lost. Please re-import your nsec.');
        }
        await setPendingOnboardingAccount(null);

        const payload = {
            accounts: [fullAccount],
            activeAccountId: fullAccount.id
        };
        await vault.create(params.password as string, payload);
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
                readOnly: !fullAccount.privkey && fullAccount.type !== 'nip46'
            });
        } else {
            const idx = accts.findIndex(a => a.id === vaultAcctId);
            if (idx !== -1) accts[idx].readOnly = !fullAccount.privkey && fullAccount.type !== 'nip46';
        }
        await browser.storage.local.set({ accounts: accts, activeAccountId: vaultAcctId });
        await storage.switchDatabase((params.upgradeFromReadOnly as string) || vaultAcctId);
        resetLocalGraph();
        return { ok: true };
    }],

    ['onboarding_addToVault', async (params) => {
        if (vault.isLocked()) throw new Error('Vault is locked');

        const pendingAcctAdd = await getPendingOnboardingAccount();
        const fullAccountAdd = pendingAcctAdd && pendingAcctAdd.id === (params.account as Record<string, string>).id
            ? pendingAcctAdd
            : params.account as Account;
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
                readOnly: !fullAccountAdd.privkey && fullAccountAdd.type !== 'nip46'
            });
        } else {
            const idx = addVaultAccts.findIndex(a => a.id === fullAccountAdd.id);
            if (idx !== -1) addVaultAccts[idx].readOnly = !fullAccountAdd.privkey && fullAccountAdd.type !== 'nip46';
        }
        await browser.storage.local.set({ accounts: addVaultAccts, activeAccountId: fullAccountAdd.id });
        await storage.switchDatabase((params.upgradeFromReadOnly as string) || fullAccountAdd.id);
        resetLocalGraph();
        refreshBadgesOnAllTabs();
        if (fullAccountAdd.pubkey) {
            broadcastAccountChanged(fullAccountAdd.pubkey);
        }
        return { ok: true };
    }],
]);
