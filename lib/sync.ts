import * as storage from './storage.ts';
import type { SyncResult, SyncProgress, RelayListEntry } from './types.ts';
import { RELAY_POOL_MAX_SIZE, RELAY_POOL_MIN_ENDORSEMENTS, MAX_RELAYS_PER_EVENT } from './constants.ts';

const BATCH_SIZE = 50; // Pubkeys per batch
const PROGRESS_INTERVAL = 200; // Min ms between progress updates
const CONNECTION_TIMEOUT = 5000; // Time to wait for relay connection
const REQUEST_TIMEOUT = 10000; // Time to wait for response
const BASE_DELAY = 50; // Base delay between requests per relay (ms)
const MAX_DELAY = 2000; // Max delay when throttled
const CONCURRENT_PER_RELAY = 5; // Max concurrent requests per relay

// ── Relay URL normalization ──

/** Normalize relay URL: strip trailing slash, lowercase */
export function normalizeRelayUrl(url: string): string {
    // Lowercase the scheme + host (path is case-sensitive per spec, but
    // relay URLs are almost always just scheme+host with no meaningful path)
    let normalized = url.toLowerCase();
    // Strip trailing slash(es) — wss://relay.damus.io/ → wss://relay.damus.io
    while (normalized.length > 6 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}

// ── Relay list parsing ──

/** Parse kind:10002 relay list tags into RelayListEntry array */
export function parseRelayListTags(tags: string[][]): RelayListEntry[] {
    const results: RelayListEntry[] = [];
    const seen = new Set<string>();

    for (const tag of tags) {
        if (results.length >= MAX_RELAYS_PER_EVENT) break;
        if (tag[0] !== 'r' || !tag[1]) continue;

        const raw = tag[1];
        // Only accept wss:// URLs (case-insensitive check)
        if (!raw.toLowerCase().startsWith('wss://')) continue;

        const url = normalizeRelayUrl(raw);

        // Deduplicate after normalization
        if (seen.has(url)) continue;
        seen.add(url);

        const marker = tag[2];
        if (marker === 'read') {
            results.push({ url, read: true, write: false });
        } else if (marker === 'write') {
            results.push({ url, read: false, write: true });
        } else {
            // No marker = both read and write
            results.push({ url, read: true, write: true });
        }
    }

    return results;
}

// ── Relay Pool ──

export class RelayPool {
    endorsements: Map<string, number> = new Map();

    ingest(relayList: RelayListEntry[]): void {
        for (const entry of relayList) {
            if (!entry.write) continue; // Only count write-relays as endorsements
            const count = this.endorsements.get(entry.url) || 0;
            this.endorsements.set(entry.url, count + 1);
        }
    }

    getTopRelays(n: number): Array<{ url: string; endorsements: number }> {
        const entries = Array.from(this.endorsements.entries())
            .filter(([, count]) => count >= RELAY_POOL_MIN_ENDORSEMENTS)
            .sort((a, b) => b[1] - a[1])
            .slice(0, Math.min(n, RELAY_POOL_MAX_SIZE));

        return entries.map(([url, endorsements]) => ({ url, endorsements }));
    }
}

let syncInProgress: boolean = false;
let syncAborted: boolean = false;
let currentSyncInstance: GraphSync | null = null;
let syncDoneResolvers: Array<() => void> = []; // Resolvers waiting for sync completion

export function isSyncInProgress(): boolean {
    return syncInProgress;
}

// Returns a promise that resolves when the current sync finishes (or immediately if none).
export function stopSync(): Promise<void> {
    if (!currentSyncInstance) return Promise.resolve();
    syncAborted = true;
    currentSyncInstance.abort();
    return new Promise(resolve => syncDoneResolvers.push(resolve));
}

interface FetchResult {
    follows: string[] | null;
    relayList: RelayListEntry[] | null;
}

interface PendingRequest {
    resolve: (result: FetchResult) => void;
    follows: string[] | null;
    followsCreatedAt: number;
    relayList: RelayListEntry[] | null;
    relayListCreatedAt: number;
    done: boolean;
}

class RelayConnection {
    url: string;
    ws: WebSocket | null;
    ready: boolean;
    pending: Map<string, PendingRequest>;
    delay: number;
    lastRequest: number;
    successCount: number;
    errorCount: number;
    inFlight: number;

    constructor(url: string) {
        this.url = url;
        this.ws = null;
        this.ready = false;
        this.pending = new Map(); // subId -> { resolve, follows, createdAt, done }
        this.delay = BASE_DELAY; // Adaptive delay
        this.lastRequest = 0;
        this.successCount = 0;
        this.errorCount = 0;
        this.inFlight = 0; // Current requests in flight
    }

    async connect(): Promise<boolean> {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.ready = false;
                resolve(false);
            }, CONNECTION_TIMEOUT);

            try {
                this.ws = new WebSocket(this.url);

                this.ws.onopen = () => {
                    clearTimeout(timeout);
                    this.ready = true;
                    resolve(true);
                };

                this.ws.onmessage = (event: MessageEvent) => this.handleMessage(event);

                this.ws.onerror = () => {
                    clearTimeout(timeout);
                    this.ready = false;
                    resolve(false);
                };

                this.ws.onclose = () => {
                    this.ready = false;
                    // Resolve any pending requests
                    for (const req of this.pending.values()) {
                        if (!req.done) {
                            req.done = true;
                            req.resolve({ follows: null, relayList: null });
                        }
                    }
                    this.pending.clear();
                };
            } catch (e) {
                clearTimeout(timeout);
                resolve(false);
            }
        });
    }

    handleMessage(event: MessageEvent): void {
        try {
            const msg = JSON.parse(event.data);
            const [type, subId, ...rest] = msg;

            if (type === 'EVENT') {
                const nostrEvent = rest[0];
                const req = this.pending.get(subId);
                if (req && !req.done) {
                    if (nostrEvent.kind === 3) {
                        // Kind 3: contact list — keep newest
                        if (nostrEvent.created_at > req.followsCreatedAt) {
                            req.followsCreatedAt = nostrEvent.created_at;
                            req.follows = (nostrEvent.tags || [])
                                .filter((tag: string[]) => tag[0] === 'p' && tag[1])
                                .map((tag: string[]) => tag[1]);
                        }
                    } else if (nostrEvent.kind === 10002) {
                        // Kind 10002: relay list — keep newest
                        if (nostrEvent.created_at > req.relayListCreatedAt) {
                            req.relayListCreatedAt = nostrEvent.created_at;
                            req.relayList = parseRelayListTags(nostrEvent.tags || []);
                        }
                    }
                }
            } else if (type === 'EOSE') {
                const req = this.pending.get(subId);
                if (req && !req.done) {
                    req.done = true;
                    this.inFlight--;
                    this.recordSuccess();
                    try { this.ws!.send(JSON.stringify(['CLOSE', subId])); } catch (e) {}
                    req.resolve({ follows: req.follows || [], relayList: req.relayList });
                    this.pending.delete(subId);
                }
            } else if (type === 'CLOSED' || type === 'NOTICE') {
                const req = this.pending.get(subId);
                if (req && !req.done) {
                    req.done = true;
                    this.inFlight--;
                    if (type === 'NOTICE') {
                        this.recordError();
                    }
                    req.resolve({ follows: req.follows || [], relayList: req.relayList });
                    this.pending.delete(subId);
                }
            }
        } catch (e) {
            // Ignore parse errors
        }
    }

    recordSuccess(): void {
        this.successCount++;
        // Gradually decrease delay on success
        if (this.successCount % 10 === 0 && this.delay > BASE_DELAY) {
            this.delay = Math.max(BASE_DELAY, this.delay * 0.8);
        }
    }

    recordError(): void {
        this.errorCount++;
        // Increase delay on error (backoff)
        this.delay = Math.min(MAX_DELAY, this.delay * 1.5);
    }

    async fetch(pubkey: string): Promise<FetchResult | null> {
        if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            return null;
        }

        // Wait if too many in flight
        while (this.inFlight >= CONCURRENT_PER_RELAY) {
            await new Promise(r => setTimeout(r, 50));
            if (!this.ready) return null;
        }

        // Respect delay between requests
        const now = Date.now();
        const elapsed = now - this.lastRequest;
        if (elapsed < this.delay) {
            await new Promise(r => setTimeout(r, this.delay - elapsed));
        }
        this.lastRequest = Date.now();

        return new Promise((resolve) => {
            const subId = `s${Math.random().toString(36).slice(2, 10)}`;

            const timeout = setTimeout(() => {
                const req = this.pending.get(subId);
                if (req && !req.done) {
                    req.done = true;
                    this.inFlight--;
                    this.recordError();
                    this.pending.delete(subId);
                    resolve(null);
                }
            }, REQUEST_TIMEOUT);

            const req: PendingRequest = {
                follows: null,
                followsCreatedAt: 0,
                relayList: null,
                relayListCreatedAt: 0,
                done: false,
                resolve: (result: FetchResult) => {
                    clearTimeout(timeout);
                    resolve(result);
                }
            };

            this.pending.set(subId, req);
            this.inFlight++;

            try {
                this.ws!.send(JSON.stringify(['REQ', subId, {
                    kinds: [3, 10002],
                    authors: [pubkey],
                    limit: 2
                }]));
            } catch (e) {
                clearTimeout(timeout);
                req.done = true;
                this.inFlight--;
                this.pending.delete(subId);
                this.recordError();
                resolve(null);
            }
        });
    }

    close(): void {
        if (this.ws && this.ws.readyState < 2) {
            try { this.ws.close(); } catch (e) {}
        }
        for (const req of this.pending.values()) {
            if (!req.done) {
                req.done = true;
                req.resolve({ follows: null, relayList: null });
            }
        }
        this.pending.clear();
        this.ready = false;
    }
}

export class GraphSync {
    relayUrls: string[];
    connections: RelayConnection[];
    onProgress: ((progress: SyncProgress) => void) | null;
    lastProgressTime: number;
    aborted: boolean;
    relayPool: RelayPool;

    constructor(relays: string[]) {
        this.relayUrls = relays;
        this.connections = [];
        this.onProgress = null;
        this.lastProgressTime = 0;
        this.aborted = false;
        this.relayPool = new RelayPool();
    }

    abort(): void {
        this.aborted = true;
        this.closeConnections();
    }

    async syncFromPubkey(rootPubkey: string, maxDepth: number = 2): Promise<SyncResult> {
        if (syncInProgress) {
            throw new Error('Sync already in progress');
        }
        syncInProgress = true;
        syncAborted = false;
        this.aborted = false;
        currentSyncInstance = this;

        await storage.setMeta('syncState', {
            inProgress: true,
            startTime: Date.now(),
            rootPubkey,
            maxDepth
        });

        try {
            await this.openConnections();
            return await this._doSync(rootPubkey, maxDepth);
        } finally {
            this.closeConnections();
            syncInProgress = false;
            currentSyncInstance = null;
            await storage.setMeta('syncState', { inProgress: false });
            // Notify anyone waiting on stopSync()
            for (const resolve of syncDoneResolvers) resolve();
            syncDoneResolvers = [];
        }
    }

    async openConnections(): Promise<void> {
        // Create and connect to all relays
        const connectPromises = this.relayUrls.map(async (url) => {
            const conn = new RelayConnection(url);
            const success = await conn.connect();
            return { conn, success };
        });

        const results = await Promise.all(connectPromises);
        this.connections = results.filter(r => r.success).map(r => r.conn);

        if (this.connections.length === 0) {
            throw new Error('Could not connect to any relay');
        }

        if (this.onProgress) {
            this.onProgress({
                fetched: 0,
                pending: 0,
                currentDepth: 0,
                maxDepth: 0,
                nodesPerDepth: {},
                total: 0,
                connectedRelays: this.connections.length,
                totalRelays: this.relayUrls.length
            });
        }
    }

    closeConnections(): void {
        for (const conn of this.connections) {
            conn.close();
        }
        this.connections = [];
    }

    // Get best relay for next request (least busy, lowest delay)
    getBestRelay(): RelayConnection | null {
        const ready = this.connections.filter(c => c.ready);
        if (ready.length === 0) return null;

        // Sort by: fewest in-flight, then lowest delay
        ready.sort((a, b) => {
            if (a.inFlight !== b.inFlight) return a.inFlight - b.inFlight;
            return a.delay - b.delay;
        });

        return ready[0];
    }

    // Fetch a pubkey's follows + relay list from ALL relays and pick the newest events.
    // Used for the root pubkey to ensure we get the most up-to-date data.
    async fetchNewestFromAllRelays(pubkey: string): Promise<FetchResult> {
        let bestFollows: string[] | null = null;
        let bestFollowsCreatedAt = 0;
        let bestRelayList: RelayListEntry[] | null = null;
        let bestRelayListCreatedAt = 0;

        const fetchPromises = this.connections.map(async (relay) => {
            if (!relay.ready || !relay.ws || relay.ws.readyState !== WebSocket.OPEN) return;

            try {
                const result = await new Promise<{
                    follows: string[] | null; followsCreatedAt: number;
                    relayList: RelayListEntry[] | null; relayListCreatedAt: number;
                }>((resolve) => {
                    const subId = `r${Math.random().toString(36).slice(2, 10)}`;
                    let eventFollows: string[] | null = null;
                    let eventFollowsCreatedAt = 0;
                    let eventRelayList: RelayListEntry[] | null = null;
                    let eventRelayListCreatedAt = 0;

                    const timeout = setTimeout(() => {
                        try { relay.ws!.send(JSON.stringify(['CLOSE', subId])); } catch {}
                        resolve({
                            follows: eventFollows, followsCreatedAt: eventFollowsCreatedAt,
                            relayList: eventRelayList, relayListCreatedAt: eventRelayListCreatedAt
                        });
                    }, REQUEST_TIMEOUT);

                    const handler = (event: MessageEvent) => {
                        try {
                            const msg = JSON.parse(event.data);
                            if (msg[1] !== subId) return;
                            if (msg[0] === 'EVENT') {
                                const ev = msg[2];
                                if (ev.kind === 3 && ev.created_at > eventFollowsCreatedAt) {
                                    eventFollowsCreatedAt = ev.created_at;
                                    eventFollows = (ev.tags || [])
                                        .filter((t: string[]) => t[0] === 'p' && t[1])
                                        .map((t: string[]) => t[1]);
                                } else if (ev.kind === 10002 && ev.created_at > eventRelayListCreatedAt) {
                                    eventRelayListCreatedAt = ev.created_at;
                                    eventRelayList = parseRelayListTags(ev.tags || []);
                                }
                            } else if (msg[0] === 'EOSE' || msg[0] === 'CLOSED') {
                                clearTimeout(timeout);
                                relay.ws!.removeEventListener('message', handler);
                                try { relay.ws!.send(JSON.stringify(['CLOSE', subId])); } catch {}
                                resolve({
                                    follows: eventFollows, followsCreatedAt: eventFollowsCreatedAt,
                                    relayList: eventRelayList, relayListCreatedAt: eventRelayListCreatedAt
                                });
                            }
                        } catch {}
                    };

                    relay.ws!.addEventListener('message', handler);
                    relay.ws!.send(JSON.stringify(['REQ', subId, {
                        kinds: [3, 10002],
                        authors: [pubkey],
                        limit: 2
                    }]));
                });

                return result;
            } catch {
                return { follows: null, followsCreatedAt: 0, relayList: null, relayListCreatedAt: 0 };
            }
        });

        const results = await Promise.all(fetchPromises);
        for (const r of results) {
            if (r) {
                if (r.follows && r.followsCreatedAt > bestFollowsCreatedAt) {
                    bestFollowsCreatedAt = r.followsCreatedAt;
                    bestFollows = r.follows;
                }
                if (r.relayList && r.relayListCreatedAt > bestRelayListCreatedAt) {
                    bestRelayListCreatedAt = r.relayListCreatedAt;
                    bestRelayList = r.relayList;
                }
            }
        }

        return { follows: bestFollows, relayList: bestRelayList };
    }

    async _doSync(rootPubkey: string, maxDepth: number): Promise<SyncResult> {
        // Fetch root from ALL relays, pick newest kind:3 + kind:10002 events
        const rootResult = await this.fetchNewestFromAllRelays(rootPubkey);
        const fetched = new Set<string>();
        const failed = new Set<string>();
        const queued = new Set<string>([rootPubkey]);
        const nodesPerDepth: Record<number, number> = {};

        if (rootResult.follows === null) {
            failed.add(rootPubkey);
        } else {
            fetched.add(rootPubkey);
            storage.saveFollows(rootPubkey, rootResult.follows);
            if (rootResult.relayList) {
                storage.saveRelayList(rootPubkey, rootResult.relayList);
                this.relayPool.ingest(rootResult.relayList);
            }
            nodesPerDepth[0] = 1;

            if (maxDepth > 0) {
                for (const f of rootResult.follows) {
                    if (!queued.has(f)) {
                        queued.add(f);
                    }
                }
            }
        }

        // Build remaining fetch queue from root's follows
        const toFetch: Array<{ pubkey: string; depth: number }> = [];
        if (rootResult.follows && maxDepth > 0) {
            for (const f of rootResult.follows) {
                toFetch.push({ pubkey: f, depth: 1 });
            }
        }

        let expandedConnections = false;

        while (toFetch.length > 0) {
            if (this.aborted) {
                await storage.flushWriteBuffer();
                return {
                    nodes: fetched.size,
                    fetched: fetched.size,
                    failed: failed.size,
                    nodesPerDepth,
                    aborted: true
                };
            }

            // Get batch of pubkeys
            const batch: string[] = [];
            const batchDepths = new Map<string, number>();

            while (batch.length < BATCH_SIZE && toFetch.length > 0) {
                const item = toFetch.shift()!;
                if (!fetched.has(item.pubkey) && !failed.has(item.pubkey)) {
                    batch.push(item.pubkey);
                    batchDepths.set(item.pubkey, item.depth);
                }
            }

            if (batch.length === 0) continue;

            // Fetch from relays
            const results = await this.fetchBatch(batch);

            for (const pubkey of batch) {
                const result = results.get(pubkey) ?? null;
                const depth = batchDepths.get(pubkey)!;

                if (result === null || result.follows === null) {
                    failed.add(pubkey);
                    if (depth === maxDepth) {
                        nodesPerDepth[depth] = (nodesPerDepth[depth] || 0) + 1;
                    }
                } else {
                    fetched.add(pubkey);
                    storage.saveFollows(pubkey, result.follows);
                    if (result.relayList) {
                        storage.saveRelayList(pubkey, result.relayList);
                        this.relayPool.ingest(result.relayList);
                    }
                    nodesPerDepth[depth] = (nodesPerDepth[depth] || 0) + 1;

                    if (depth < maxDepth) {
                        for (const f of result.follows) {
                            if (!fetched.has(f) && !failed.has(f) && !queued.has(f)) {
                                queued.add(f);
                                toFetch.push({ pubkey: f, depth: depth + 1 });
                            }
                        }
                    }
                }
            }

            // After depth 0 batch completes, expand connections with discovered relays
            if (!expandedConnections && nodesPerDepth[1] !== undefined) {
                expandedConnections = true;
                await this.expandConnections();
            }

            // Progress update
            const now = Date.now();
            if (this.onProgress && (now - this.lastProgressTime) >= PROGRESS_INTERVAL) {
                this.lastProgressTime = now;
                const maxDepthSoFar = Math.max(...Object.keys(nodesPerDepth).map(Number), 0);
                this.onProgress({
                    fetched: fetched.size,
                    pending: toFetch.length,
                    currentDepth: maxDepthSoFar,
                    maxDepth,
                    nodesPerDepth: { ...nodesPerDepth },
                    total: fetched.size
                });
            }
        }

        // Final progress
        if (this.onProgress) {
            this.onProgress({
                fetched: fetched.size,
                pending: 0,
                currentDepth: maxDepth,
                maxDepth,
                nodesPerDepth: { ...nodesPerDepth },
                total: fetched.size
            });
        }

        await storage.flushWriteBuffer();
        await storage.setMeta('lastSync', Date.now());
        await storage.setMeta('nodesPerDepth', nodesPerDepth);
        await storage.setMeta('syncDepth', maxDepth);

        return {
            nodes: fetched.size,
            fetched: fetched.size,
            failed: failed.size,
            nodesPerDepth
        };
    }

    // Expand connections with discovered relays from the relay pool
    async expandConnections(): Promise<void> {
        const MAX_TOTAL_CONNECTIONS = 10;
        const currentCount = this.connections.filter(c => c.ready).length;
        const slotsAvailable = MAX_TOTAL_CONNECTIONS - currentCount;
        if (slotsAvailable <= 0) return;

        const existingUrls = new Set(this.connections.map(c => normalizeRelayUrl(c.url)));
        const topRelays = this.relayPool.getTopRelays(slotsAvailable);
        const newUrls = topRelays
            .map(r => r.url)
            .filter(url => !existingUrls.has(url))
            .slice(0, slotsAvailable);

        if (newUrls.length === 0) return;

        const connectPromises = newUrls.map(async (url) => {
            const conn = new RelayConnection(url);
            const success = await conn.connect();
            return { conn, success };
        });

        const results = await Promise.all(connectPromises);
        for (const { conn, success } of results) {
            if (success) {
                this.connections.push(conn);
            }
        }
    }

    // Fetch batch of pubkeys, distributing across relays
    async fetchBatch(pubkeys: string[]): Promise<Map<string, FetchResult | null>> {
        const results = new Map<string, FetchResult | null>();
        for (const pk of pubkeys) {
            results.set(pk, null);
        }

        // Create fetch promises distributed across relays
        const fetchPromises = pubkeys.map(async (pubkey) => {
            // Try relays in order of preference until one succeeds
            const tried = new Set<RelayConnection>();

            for (let attempt = 0; attempt < this.connections.length; attempt++) {
                if (this.aborted) return;

                const relay = this.getBestRelay();
                if (!relay || tried.has(relay)) {
                    break;
                }
                tried.add(relay);

                const result = await relay.fetch(pubkey);
                if (result !== null) {
                    results.set(pubkey, result);
                    return;
                }
            }
        });

        await Promise.all(fetchPromises);
        return results;
    }
}
