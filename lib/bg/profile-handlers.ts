/**
 * Profile metadata and NIP-51 mute list (kind:10000) handlers.
 * @module lib/bg/profile-handlers
 */

import browser from '../browser.ts';
import * as vault from '../vault.ts';
import { randomHex } from '../crypto/utils.ts';
import { verifyEvent } from '../crypto/nip01.ts';
import { cachedRelayRead, MUTE_LIST_CACHE } from './relayCache.ts';
import type { SignedEvent } from '../types.ts';

import { config, DEFAULT_RELAYS, profileCache, PROFILE_CACHE_TTL, type HandlerFn, type ProfileCacheEntry } from './state.ts';

/**
 * Accept a relay's EVENT only if it is really the event we asked for.
 *
 * A relay is an untrusted party. Matching on `pubkey` and `kind` alone checks
 * only what the relay *claims* — those fields are just JSON until the signature
 * over them is verified, so any relay could serve a document attributed to
 * anyone, with a `created_at` high enough to win.
 *
 * That matters here beyond display, because both readers below feed a
 * read-modify-write of a REPLACEABLE event: `fetchKind0Read` is what
 * `getProfileForMerge` hands to the caller that republishes the profile, and
 * `fetchMuteList` supplies the `rawContent` that `publishMuteList` writes back
 * verbatim as the user's NIP-44-encrypted private mutes. An unverified event
 * accepted here is therefore not merely displayed — it is re-signed by the user
 * and published as their own.
 */
async function acceptedEvent(
    raw: unknown,
    pubkey: string,
    kind: number,
): Promise<SignedEvent | null> {
    const ev = raw as SignedEvent | undefined;
    if (!ev || ev.pubkey !== pubkey || ev.kind !== kind) return null;
    if (!ev.id || !ev.sig) return null;
    if (!(await verifyEvent(ev))) return null;
    return ev;
}

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

/** The outcome of a profile read, distinguishing "nothing there" from "could not ask". */
export interface ProfileRead {
    metadata: Record<string, unknown> | null;
    /**
     * True when at least one relay actually answered — delivered the event, or
     * reached EOSE, which is a relay saying authoritatively that it holds no
     * kind:0 for this pubkey. False means every relay errored or timed out, and
     * the null metadata carries no information at all.
     */
    reachable: boolean;
}

export async function fetchKind0(pubkey: string, relayUrls: string[]): Promise<Record<string, unknown> | null> {
    return (await fetchKind0Read(pubkey, relayUrls)).metadata;
}

/**
 * Read a pubkey's kind:0, reporting whether anyone answered.
 *
 * Merging a patch into the result of a *failed* read and publishing it destroys
 * the profile: kind:0 is replaceable, so a document containing only the field
 * being added replaces the one with the user's name, picture and nip05. That is
 * indistinguishable from a legitimate first-ever profile unless the reader says
 * which case it saw, so it says.
 */
export function fetchKind0Read(pubkey: string, relayUrls: string[]): Promise<ProfileRead> {
    return new Promise((resolve) => {
        let best: Record<string, unknown> | null = null;
        let bestCreatedAt = 0;
        let remaining = relayUrls.length;
        let resolved = false;
        // Signature checks are async, so a relay's last EVENT can still be in
        // flight when its EOSE arrives. Resolving then would silently drop a
        // verified answer; `done()` waits for the count to drain.
        let verifying = 0;
        let closing = false;
        // Per-socket honesty. A relay that served an event failing verification
        // does not get to vouch for emptiness with its EOSE: "nobody answered"
        // and "the only answer was a forgery" must not collapse into the
        // `reachable: true, metadata: null` that means "safe to overwrite".
        const sockets: { eose: boolean; valid: boolean; invalid: boolean }[] = [];
        const anyHonestAnswer = () => sockets.some((s) => (s.eose || s.valid) && !s.invalid);

        const done = () => {
            closing = true;
            if (verifying > 0) return;
            if (!resolved) { resolved = true; clearTimeout(timer); resolve({ metadata: best, reachable: anyHonestAnswer() }); }
        };

        const timer = setTimeout(() => { verifying = 0; done(); }, 5000);

        const checkRemaining = () => { if (--remaining <= 0) done(); };

        for (const url of relayUrls) {
            try {
                const ws = new WebSocket(url);
                const subId = 'p' + randomHex(6);
                const st = { eose: false, valid: false, invalid: false };
                sockets.push(st);
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
                            verifying++;
                            void (async () => {
                                try {
                                    const event = await acceptedEvent(msg[2], pubkey, 0);
                                    if (!event) { st.invalid = true; return; }
                                    st.valid = true;
                                    if (event.created_at > bestCreatedAt) {
                                        bestCreatedAt = event.created_at;
                                        best = JSON.parse(event.content);
                                    }
                                } catch { /* unparseable content — not an answer */ }
                                finally {
                                    verifying--;
                                    if (closing) done();
                                }
                            })();
                        } else if (msg[0] === 'EOSE') {
                            // EOSE is an answer: this relay has told us what it holds,
                            // including when that is nothing — unless it also sent us
                            // something that did not verify.
                            st.eose = true;
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
 *
 * `reachable` reports whether any relay actually answered — delivered the event,
 * or reached EOSE, which is a relay stating it holds no list. Without it a total
 * relay timeout resolved the zeroed list through the SUCCESS path, and a caller
 * could not tell "you mute nobody" from "nobody answered". That distinction is
 * load-bearing: the empty `rawContent` of an unreachable read, published back,
 * replaces the user's NIP-44-encrypted private mutes with nothing. The comment
 * on publishMuteList calls round-tripping rawContent CRITICAL for exactly this
 * reason, and a failed read is the one case where it silently is not doing it.
 */
export function fetchMuteList(pubkey: string, relayUrls: string[]): Promise<GroupedMuteList & { reachable: boolean }> {
    return new Promise((resolve) => {
        const best: GroupedMuteList = { people: [], hashtags: [], words: [], events: [], rawContent: '', createdAt: 0 };
        let remaining = relayUrls.length;
        let resolved = false;
        let verifying = 0;
        let closing = false;
        // See fetchKind0Read: a relay that served an unverifiable event cannot
        // then vouch for emptiness. Here the stake is `rawContent`, which
        // publishMuteList writes back as the user's private mutes.
        const sockets: { eose: boolean; valid: boolean; invalid: boolean }[] = [];
        const anyHonestAnswer = () => sockets.some((s) => (s.eose || s.valid) && !s.invalid);

        const done = () => {
            closing = true;
            if (verifying > 0) return;
            if (!resolved) { resolved = true; clearTimeout(timer); resolve({ ...best, reachable: anyHonestAnswer() }); }
        };
        const timer = setTimeout(() => { verifying = 0; done(); }, 8000);
        const checkRemaining = () => { if (--remaining <= 0) done(); };

        for (const url of relayUrls) {
            try {
                const ws = new WebSocket(url);
                const subId = 'm' + randomHex(6);
                const st = { eose: false, valid: false, invalid: false };
                sockets.push(st);
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
                            verifying++;
                            void (async () => {
                                try {
                                    const event = await acceptedEvent(msg[2], pubkey, 10000);
                                    if (!event) { st.invalid = true; return; }
                                    st.valid = true;
                                    if (event.created_at <= best.createdAt) return;
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
                                } finally {
                                    verifying--;
                                    if (closing) done();
                                }
                            })();
                        } else if (msg[0] === 'EOSE') {
                            // An answer, including when it means "I hold no list" —
                            // unless this relay also sent something unverifiable.
                            st.eose = true;
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

    /**
     * A profile read for a caller that is about to merge into it and publish.
     *
     * Deliberately not `getProfileMetadata`: that one caches, and it collapses
     * "no profile" and "no relay answered" into the same null. A caller building
     * a replaceable kind:0 needs both distinctions — the freshest document it can
     * get, and an honest signal when it could not get one.
     */
    ['getProfileForMerge', async (params) => {
        const relays = config.relays.length > 0 ? config.relays : DEFAULT_RELAYS;
        return await fetchKind0Read(params.pubkey as string, relays);
    }],

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
            // No account is a definite answer, not a failed read.
            return { people: [], hashtags: [], words: [], events: [], rawContent: '', createdAt: 0, reachable: true };
        }
        // Cached-first so the home card does not wait on a relay; refreshed
        // behind, and an unreachable read never replaces a real one. The
        // `reachable: false` shape doubles as the cache's unreachable marker.
        return await cachedRelayRead(MUTE_LIST_CACHE, myPubkey, async () => {
            const relays = await getUserRelays();
            const list = await fetchMuteList(myPubkey, relays);
            return { ...list, unreachable: !list.reachable };
        });
    }],
]);
