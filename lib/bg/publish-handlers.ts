/**
 * Event broadcasting, relay publishing, event signing, NIP-46 session management,
 * and health check handlers.
 * @module lib/bg/publish-handlers
 */

import browser from '../browser.ts';
import { signEvent } from '../crypto/nip01.ts';
import * as vault from '../vault.ts';
import * as signer from '../signer.ts';
import { config, type HandlerFn } from './state.ts';
import type { UnsignedEvent, SignedEvent } from '../types.ts';

// ── Event Broadcasting ──

export async function broadcastEvent(signedEvent: SignedEvent, relayUrls: string[]): Promise<{ sent: number; failed: number }> {
    const results = { sent: 0, failed: 0 };

    const promises = relayUrls.map(url => new Promise<void>((resolve) => {
        try {
            const ws = new WebSocket(url);
            const timeout = setTimeout(() => {
                try { ws.close(); } catch { /* ignored */ }
                results.failed++;
                resolve();
            }, 5000);

            ws.onopen = () => {
                try {
                    ws.send(JSON.stringify(['EVENT', signedEvent]));
                } catch {
                    clearTimeout(timeout);
                    results.failed++;
                    resolve();
                    return;
                }
            };

            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg[0] === 'OK' && msg[1] === signedEvent.id) {
                        clearTimeout(timeout);
                        if (msg[2] === true) results.sent++;
                        else results.failed++;
                        try { ws.close(); } catch { /* ignored */ }
                        resolve();
                    }
                } catch { /* ignored */ }
            };

            ws.onerror = () => {
                clearTimeout(timeout);
                results.failed++;
                resolve();
            };
        } catch {
            results.failed++;
            resolve();
        }
    }));

    await Promise.all(promises);
    return results;
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['publishRelayList', async () => {
        const privkeyBytes = vault.getPrivkey();
        if (!privkeyBytes) throw new Error('Vault is locked or no private key');

        try {
            const relayData = await browser.storage.sync.get(['relays']) as Record<string, string>;
            const flagData = await browser.storage.local.get(['relayFlags']) as Record<string, Record<string, { read: boolean; write: boolean }>>;
            const relaysCsv = relayData.relays || '';
            const relayUrls = relaysCsv.split(',').map(r => r.trim()).filter(Boolean);
            const flags = flagData.relayFlags || {};

            const tags: string[][] = [];
            for (const url of relayUrls) {
                const f = flags[url] || { read: true, write: true };
                if (f.read && f.write) {
                    tags.push(['r', url]);
                } else if (f.read) {
                    tags.push(['r', url, 'read']);
                } else if (f.write) {
                    tags.push(['r', url, 'write']);
                }
            }

            const event: UnsignedEvent = {
                created_at: Math.floor(Date.now() / 1000),
                kind: 10002,
                tags,
                content: ''
            };

            const signed = await signEvent(event, privkeyBytes);
            const broadcastUrls = relayUrls.length > 0 ? relayUrls : config.relays;
            const result = await broadcastEvent(signed, broadcastUrls);

            await browser.storage.local.set({
                lastRelayPublish: Date.now(),
                lastPublishedRelays: relaysCsv
            });

            return { ok: true, sent: result.sent, failed: result.failed };
        } finally {
            privkeyBytes.fill(0);
        }
    }],

    ['publishMuteList', async (params) => {
        // Build & publish the active account's OWN NIP-51 kind:10000 mute list.
        // CRITICAL: `.content` is set to the caller-supplied `rawContent` (the
        // user's existing NIP-44-encrypted PRIVATE entries, fetched verbatim by
        // getMyMuteList) so publishing public mutes never destroys private ones.
        const privkeyBytes = vault.getPrivkey();
        if (!privkeyBytes) throw new Error('Vault is locked or no private key');

        try {
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

            const signed = await signEvent(event, privkeyBytes);

            // Mirror publishRelayList: publish to the user's WRITE relays.
            const relayData = await browser.storage.sync.get(['relays']) as Record<string, string>;
            const flagData = await browser.storage.local.get(['relayFlags']) as Record<string, Record<string, { read: boolean; write: boolean }>>;
            const relayUrls = (relayData.relays || '').split(',').map(r => r.trim()).filter(Boolean);
            const flags = flagData.relayFlags || {};
            const writeRelays = relayUrls.filter(url => (flags[url] || { read: true, write: true }).write);
            const broadcastUrls = writeRelays.length > 0 ? writeRelays : (relayUrls.length > 0 ? relayUrls : config.relays);

            const result = await broadcastEvent(signed, broadcastUrls);
            return { ok: true, sent: result.sent > 0, sentCount: result.sent, failed: result.failed };
        } finally {
            privkeyBytes.fill(0);
        }
    }],

    ['signEvent', async (params) => {
        if (!params.event || typeof (params.event as Record<string, unknown>).kind !== 'number') throw new Error('Invalid event');
        const privkeyBytes = vault.getPrivkey();
        if (!privkeyBytes) throw new Error('Vault is locked');
        try {
            return await signEvent(params.event as UnsignedEvent, privkeyBytes);
        } finally {
            privkeyBytes.fill(0);
        }
    }],

    ['signAndPublishEvent', async (params) => {
        if (!params.event || typeof (params.event as Record<string, unknown>).kind !== 'number') throw new Error('Invalid event');
        const privkeyBytes = vault.getPrivkey();
        if (!privkeyBytes) throw new Error('Vault is locked');
        try {
            const signed = await signEvent(params.event as UnsignedEvent, privkeyBytes);
            const result = await broadcastEvent(signed, config.relays);
            return { ok: true, sent: result.sent, failed: result.failed };
        } finally {
            privkeyBytes.fill(0);
        }
    }],

    ['nip46_getSessionInfo', async () => {
        const nip46Data = await browser.storage.local.get(['activeAccountId']) as Record<string, string>;
        const nip46Acct = nip46Data.activeAccountId
            ? vault.getAccountById(nip46Data.activeAccountId)
            : null;
        if (!nip46Acct || nip46Acct.type !== 'nip46') return null;

        const nip46Config = nip46Acct.nip46Config;
        if (!nip46Config) return null;

        const clientConnected = signer.isNip46Connected(nip46Acct.id);

        return {
            bunkerPubkey: nip46Acct.pubkey,
            relay: nip46Config.relay,
            connected: clientConnected,
            accountId: nip46Acct.id,
            accountName: nip46Acct.name
        };
    }],

    ['nip46_revokeSession', async (params) => {
        signer.disconnectNip46(params.accountId as string);
        return { ok: true };
    }],

    ['checkRelayHealth', async (params) => {
        const { url } = params as { url: string };
        try {
            const httpUrl = url.replace('wss://', 'https://').replace('ws://', 'http://');
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
