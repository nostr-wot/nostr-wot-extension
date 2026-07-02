/**
 * Profile metadata and NIP-51 mute list (kind:10000) handlers.
 * @module lib/bg/profile-handlers
 */

import browser from '../browser.ts';
import * as vault from '../vault.ts';
import { randomHex } from '../crypto/utils.ts';
import { config, DEFAULT_RELAYS, profileCache, PROFILE_CACHE_TTL, type HandlerFn, type ProfileCacheEntry } from './state.ts';

/** Public entries of a NIP-51 mute list, grouped by tag type, plus the raw
 *  (still-encrypted) private `.content` so callers can round-trip it verbatim. */
export interface GroupedMuteList {
    people: string[];   // 'p' tags  — muted pubkeys (hex)
    hashtags: string[]; // 't' tags  — muted hashtags
    words: string[];    // 'word' tags — muted words
    events: string[];   // 'e' tags  — muted threads/events
    rawContent: string; // encrypted private entries, preserved verbatim ('' if none)
    createdAt: number;  // created_at of the newest event seen (0 if none)
}

/** Read the active user's configured relays (sync.relays CSV), falling back to config/defaults. */
async function getUserRelays(): Promise<string[]> {
    const relayData = await browser.storage.sync.get(['relays']) as Record<string, string>;
    const csv = relayData.relays || '';
    const urls = csv.split(',').map(r => r.trim()).filter(Boolean);
    if (urls.length > 0) return urls;
    return config.relays.length > 0 ? config.relays : DEFAULT_RELAYS;
}

// ── Profile Metadata ──

export async function fetchProfileMetadata(pubkey: string): Promise<Record<string, unknown> | null> {
    if (!pubkey) return null;

    const cached = profileCache.get(pubkey);
    if (cached && Date.now() - cached.fetchedAt < PROFILE_CACHE_TTL) {
        return cached.metadata;
    }

    const storageKey = `profile_${pubkey}`;
    const stored = await browser.storage.local.get(storageKey) as Record<string, ProfileCacheEntry>;
    if (stored[storageKey] && Date.now() - stored[storageKey].fetchedAt < PROFILE_CACHE_TTL) {
        profileCache.set(pubkey, stored[storageKey]);
        return stored[storageKey].metadata;
    }

    const relays = config.relays.length > 0 ? config.relays : DEFAULT_RELAYS;
    const metadata = await fetchKind0(pubkey, relays);

    if (metadata) {
        const entry = { metadata, fetchedAt: Date.now() };
        profileCache.set(pubkey, entry);
        await browser.storage.local.set({ [storageKey]: entry });
    }

    return metadata;
}

export function fetchKind0(pubkey: string, relayUrls: string[]): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
        let best: Record<string, unknown> | null = null;
        let bestCreatedAt = 0;
        let remaining = relayUrls.length;
        let resolved = false;

        const done = () => {
            if (!resolved) { resolved = true; clearTimeout(timer); resolve(best); }
        };

        const timer = setTimeout(done, 5000);

        const checkRemaining = () => { if (--remaining <= 0) done(); };

        for (const url of relayUrls) {
            try {
                const ws = new WebSocket(url);
                const subId = 'p' + randomHex(6);
                let closed = false;

                const closeWs = () => {
                    if (!closed) { closed = true; try { ws.close(); } catch { /* ignored */ } checkRemaining(); }
                };

                ws.onopen = () => {
                    ws.send(JSON.stringify(['REQ', subId, { kinds: [0], authors: [pubkey], limit: 1 }]));
                };

                ws.onmessage = (e) => {
                    try {
                        const msg = JSON.parse(e.data);
                        if (msg[0] === 'EVENT' && msg[1] === subId) {
                            const event = msg[2];
                            if (event.pubkey !== pubkey || event.kind !== 0) return;
                            if (event.created_at > bestCreatedAt) {
                                bestCreatedAt = event.created_at;
                                best = JSON.parse(event.content);
                            }
                        } else if (msg[0] === 'EOSE') {
                            closeWs();
                        }
                    } catch { /* ignore parse errors */ }
                };

                ws.onerror = () => closeWs();
                setTimeout(closeWs, 4000);
            } catch {
                checkRemaining();
            }
        }
    });
}

/**
 * Fetch a pubkey's newest kind:10000 mute list and return its PUBLIC entries
 * grouped by tag type. The private entries (NIP-44 encrypted in `.content`) are
 * NOT decrypted here — the raw string is returned verbatim as `rawContent` so a
 * later publish can round-trip them without destroying the user's private mutes.
 * Returns a zeroed GroupedMuteList (createdAt 0) if no list is found.
 */
export function fetchMuteList(pubkey: string, relayUrls: string[]): Promise<GroupedMuteList> {
    return new Promise((resolve) => {
        const best: GroupedMuteList = { people: [], hashtags: [], words: [], events: [], rawContent: '', createdAt: 0 };
        let remaining = relayUrls.length;
        let resolved = false;

        const done = () => {
            if (!resolved) { resolved = true; clearTimeout(timer); resolve(best); }
        };
        const timer = setTimeout(done, 8000);
        const checkRemaining = () => { if (--remaining <= 0) done(); };

        for (const url of relayUrls) {
            try {
                const ws = new WebSocket(url);
                const subId = 'm' + randomHex(6);
                let closed = false;
                const closeWs = () => {
                    if (!closed) { closed = true; try { ws.close(); } catch { /* ignored */ } checkRemaining(); }
                };

                ws.onopen = () => {
                    ws.send(JSON.stringify(['REQ', subId, { kinds: [10000], authors: [pubkey], limit: 1 }]));
                };

                ws.onmessage = (e) => {
                    try {
                        const msg = JSON.parse(e.data);
                        if (msg[0] === 'EVENT' && msg[1] === subId) {
                            const event = msg[2];
                            if (event.pubkey === pubkey && event.kind === 10000 && event.created_at > best.createdAt) {
                                best.createdAt = event.created_at;
                                best.rawContent = typeof event.content === 'string' ? event.content : '';
                                best.people = [];
                                best.hashtags = [];
                                best.words = [];
                                best.events = [];
                                for (const tag of (event.tags || [])) {
                                    if (!Array.isArray(tag) || !tag[1]) continue;
                                    if (tag[0] === 'p') best.people.push(tag[1]);
                                    else if (tag[0] === 't') best.hashtags.push(tag[1]);
                                    else if (tag[0] === 'word') best.words.push(tag[1]);
                                    else if (tag[0] === 'e') best.events.push(tag[1]);
                                }
                            }
                        } else if (msg[0] === 'EOSE') {
                            closeWs();
                        }
                    } catch { /* ignored */ }
                };

                ws.onerror = () => closeWs();
                setTimeout(closeWs, 6000);
            } catch {
                checkRemaining();
            }
        }
    });
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['getProfileMetadata', async (params) => fetchProfileMetadata(params.pubkey as string)],

    ['getProfileMetadataBatch', async (params) => {
        const pubkeys = params.pubkeys as string[];
        if (!Array.isArray(pubkeys)) throw new Error('pubkeys must be an array');
        const results: Record<string, Record<string, unknown> | null> = {};
        await Promise.all(pubkeys.map(async (pk) => {
            results[pk] = await fetchProfileMetadata(pk);
        }));
        return results;
    }],

    ['updateProfileCache', async (params) => {
        const { pubkey, metadata } = params as { pubkey: string; metadata: Record<string, unknown> };
        if (!pubkey || !metadata) throw new Error('Missing pubkey or metadata');
        const entry = { metadata, fetchedAt: Date.now() };
        profileCache.set(pubkey, entry);
        await browser.storage.local.set({ [`profile_${pubkey}`]: entry });
        return { ok: true };
    }],

    // Fetch ANOTHER pubkey's public mute list (for "import public list" feature).
    // `params.pubkey` is normalized npub→hex by background.ts before dispatch.
    ['fetchMuteList', async (params) => {
        const pubkey = params.pubkey as string;
        if (!pubkey) return { ok: false, error: 'Missing pubkey' };
        const relays = await getUserRelays();
        const list = await fetchMuteList(pubkey, relays);
        return { ok: true, ...list };
    }],

    // Fetch the ACTIVE account's OWN kind:10000 mute list, grouped by type.
    ['getMyMuteList', async () => {
        const myPubkey = vault.getActivePubkey();
        if (!myPubkey) {
            return { people: [], hashtags: [], words: [], events: [], rawContent: '', createdAt: 0 };
        }
        const relays = await getUserRelays();
        return await fetchMuteList(myPubkey, relays);
    }],
]);
