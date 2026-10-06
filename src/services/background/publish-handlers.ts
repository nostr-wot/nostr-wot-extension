/**
 * Event broadcasting, relay publishing, event signing, NIP-46 session management,
 * and health check handlers.
 * @module services/background/publish-handlers
 */

import { publishRelay } from '../relays/transport.ts';
import browser from '../../lib/browser.ts';
import { configuredRelayUrls, relayPublicationTags, type RelayConfiguration } from '../../domain/relays/relayList.ts';
import { writeLocalCache } from '../relays/relay.ts';
import { signEvent } from '../../lib/crypto/nip01.ts';
import * as vault from '../vault/vault.ts';
import { captureAccountSession, assertAccountSession } from '../signing/accountSession.ts';
import * as signerRemoteSigner from '../signing/remoteSigner.ts';
import { config, type HandlerFn } from './state.ts';
import type { UnsignedEvent, SignedEvent } from '../../domain/nostr/types.ts';

// ── Event Broadcasting ──

export async function broadcastEvent(signedEvent: SignedEvent, relayUrls: string[], assertSession?: () => void): Promise<{ sent: number; failed: number }> {
    const results = await Promise.all(relayUrls.map(url => publishRelay(url, signedEvent, { assertSession })));
    return { sent: results.filter(result => result.accepted).length, failed: results.filter(result => !result.accepted).length };
}

// ── Relay health check helpers ──

/**
 * Rejects private/loopback/link-local hosts so checkRelayHealth can't be used
 * as an SSRF probe against the local machine or internal network.
 */
export function isPrivateHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;

    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 0 ||                          // 0.0.0.0/8
        a === 127 ||                           // 127.0.0.0/8 loopback
        a === 10 ||                            // 10.0.0.0/8
        (a === 172 && b >= 16 && b <= 31) ||   // 172.16.0.0/12
        (a === 192 && b === 168) ||            // 192.168.0.0/16
        (a === 169 && b === 254);              // 169.254.0.0/16 link-local
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['publishRelayList', async (params) => {
        await vault.whenStartupUnlockSettled();
        if (params.pubkey && params.pubkey !== vault.getActivePubkey()) throw new Error('Active account changed');
        const accountId = vault.getActiveAccountId();
        if (!accountId) throw new Error('Vault is locked or no private key');
        const session = captureAccountSession(accountId);

        const relayData = await browser.storage.sync.get(['relays']) as Record<string, string>;
        const flagData = await browser.storage.local.get(['relayFlags']) as Record<string, Record<string, { read: boolean; write: boolean }>>;
        const configuration = params.configuration as RelayConfiguration | undefined;
        const relayUrls = configuration ? configuration.relays : configuredRelayUrls(relayData.relays);
        const flags = configuration ? configuration.flags : flagData.relayFlags || {};
        const tags = relayPublicationTags({ relays: relayUrls, flags });
        const relaysCsv = relayUrls.join(',');

        const event: UnsignedEvent = {
            created_at: Math.floor(Date.now() / 1000),
            kind: 10002,
            tags,
            content: ''
        };

        // Sign INSIDE the scope, broadcast OUTSIDE it. The old shape took a `getPrivkey()`
        // copy before the storage reads and held it live through the signing AND the relay
        // broadcast, so the key sat in memory for the whole of a network round trip that can
        // stall for as long as a relay takes to answer. That is the leak the note in
        // `pqc-handlers.ts` describes, here as well.
        //
        // The scope is kept to the signing rather than wrapped around the broadcast for a
        // second reason: `withPrivkey` is the place a future revocation check belongs, and a
        // scope that is voided cannot unsend. A callback that published would already have put
        // the event on the wire, so every side effect stays downstream of the returned value.
        assertAccountSession(session);
        const signed = await vault.withPrivkey(accountId, async privkey => signEvent(event, privkey));

        const broadcastUrls = [...new Set([...relayUrls, ...config.relays])];
        assertAccountSession(session);
        const result = await broadcastEvent(signed, broadcastUrls, () => assertAccountSession(session));

        if (result.sent > 0) {
            await writeLocalCache(signed);
            assertAccountSession(session);
            await browser.storage.local.set({
                lastRelayPublish: Date.now(),
                lastPublishedRelays: relaysCsv
            });
        }

        return { ok: true, sent: result.sent, failed: result.failed };
    }],

    ['publishMuteList', async (params) => {
        // Build & publish the active account's OWN NIP-51 kind:10000 mute list.
        // CRITICAL: `.content` is set to the caller-supplied `rawContent` (the
        // user's existing NIP-44-encrypted PRIVATE entries, fetched verbatim by
        // getMyMuteList) so publishing public mutes never destroys private ones.
        // Checked before the key is touched, because it is a fact about the
        // caller's input rather than about this device.
        //
        // The round-trip above is only CRITICAL while `rawContent` is genuinely
        // the user's. When the read that produced it reached no relay at all,
        // `rawContent` is the empty string that a total timeout resolves — and
        // publishing that replaces every NIP-44-encrypted private mute with
        // nothing. The caller must state that its list came from a read someone
        // answered; an unstated one is treated as unreachable rather than
        // assumed good, because this event is replaceable and the loss is total.
        if (params.readReachable !== true) {
            throw new Error('Refusing to publish a mute list built from a read no relay answered');
        }

        const accountId = vault.getActiveAccountId();
        if (!accountId) throw new Error('Vault is locked or no private key');
        const session = captureAccountSession(accountId);

        const people = Array.isArray(params.people) ? (params.people as string[]) : [];
        const hashtags = Array.isArray(params.hashtags) ? (params.hashtags as string[]) : [];
        const words = Array.isArray(params.words) ? (params.words as string[]) : [];
        const events = Array.isArray(params.events) ? (params.events as string[]) : [];
        const rawContent = typeof params.rawContent === 'string' ? params.rawContent : '';

        const tags: string[][] = [];
        for (const p of people) if (p) tags.push(['p', p]);
        for (const e of events) if (e) tags.push(['e', e]);
        for (const ht of hashtags) if (ht) tags.push(['t', ht]);
        for (const w of words) if (w) tags.push(['word', w]);

        const event: UnsignedEvent = {
            created_at: Math.floor(Date.now() / 1000),
            kind: 10000,
            tags,
            content: rawContent
        };

        // Sign inside the scope; see the note in publishRelayList.
        assertAccountSession(session);
        const signed = await vault.withPrivkey(accountId, async privkey => signEvent(event, privkey));

        // Mirror publishRelayList: publish to the user's WRITE relays.
        const relayData = await browser.storage.sync.get(['relays']) as Record<string, string>;
        const flagData = await browser.storage.local.get(['relayFlags']) as Record<string, Record<string, { read: boolean; write: boolean }>>;
        const relayUrls = (relayData.relays || '').split(',').map(r => r.trim()).filter(Boolean);
        const flags = flagData.relayFlags || {};
        const writeRelays = relayUrls.filter(url => (flags[url] || { read: true, write: true }).write);
        const broadcastUrls = writeRelays.length > 0 ? writeRelays : (relayUrls.length > 0 ? relayUrls : config.relays);

        assertAccountSession(session);
        const result = await broadcastEvent(signed, broadcastUrls, () => assertAccountSession(session));
        return { ok: true, sent: result.sent > 0, sentCount: result.sent, failed: result.failed };
    }],

    ['signEvent', async (params) => {
        if (!params.event || typeof (params.event as Record<string, unknown>).kind !== 'number') throw new Error('Invalid event');
        const accountId = vault.getActiveAccountId();
        if (!accountId) throw new Error('Vault is locked');
        const session = captureAccountSession(accountId);
        const signed = await vault.withPrivkey(accountId, async privkey => signEvent(params.event as UnsignedEvent, privkey));
        assertAccountSession(session);
        return signed;
    }],

    ['signAndPublishEvent', async (params) => {
        if (!params.event || typeof (params.event as Record<string, unknown>).kind !== 'number') throw new Error('Invalid event');
        const accountId = vault.getActiveAccountId();
        if (!accountId) throw new Error('Vault is locked');
        const session = captureAccountSession(accountId);
        // Sign inside, broadcast outside: the whole point of the split. The old shape held the
        // key live across the broadcast, so it stayed in memory for the length of a relay
        // round trip that has no use for it.
        assertAccountSession(session);
        const signed = await vault.withPrivkey(accountId, async privkey => signEvent(params.event as UnsignedEvent, privkey));
        assertAccountSession(session);
        const result = await broadcastEvent(signed, config.relays, () => assertAccountSession(session));
        return { ok: true, sent: result.sent, failed: result.failed };
    }],

    ['nip46_getSessionInfo', async () => {
        const nip46Data = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
        const nip46Acct = nip46Data.activeAccountId
            ? vault.getAccountForRemoteSigning(nip46Data.activeAccountId)
            : null;
        if (!nip46Acct || nip46Acct.type !== 'nip46') return null;

        const nip46Config = nip46Acct.nip46Config;
        if (!nip46Config) return null;

        const clientConnected = signerRemoteSigner.isNip46Connected(nip46Acct.id);

        return {
            bunkerPubkey: nip46Acct.pubkey,
            relay: nip46Config.relay,
            connected: clientConnected,
            accountId: nip46Acct.id,
            accountName: nip46Acct.name
        };
    }],

    ['nip46_revokeSession', async (params) => {
        signerRemoteSigner.disconnectNip46(params.accountId as string);
        return { ok: true };
    }],

    ['checkRelayHealth', async (params) => {
        const { url } = params as { url: string };
        try {
            // Only probe genuine relay URLs (ws:// or wss://) — never let the
            // caller point this fetch at arbitrary schemes or internal hosts.
            if (typeof url !== 'string' || !/^wss?:\/\//i.test(url)) {
                return { reachable: false };
            }
            const parsed = new URL(url);
            if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
                return { reachable: false };
            }
            if (isPrivateHost(parsed.hostname)) {
                return { reachable: false };
            }
            const scheme = parsed.protocol === 'wss:' ? 'https:' : 'http:';
            const httpUrl = `${scheme}//${parsed.host}${parsed.pathname}${parsed.search}`;
            const res = await fetch(httpUrl, {
                headers: { 'Accept': 'application/nostr+json' },
                signal: AbortSignal.timeout(5000)
            });
            return { reachable: res.ok };
        } catch {
            return { reachable: false };
        }
    }],
]);
