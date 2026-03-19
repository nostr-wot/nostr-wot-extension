#!/usr/bin/env tsx
/**
 * Relay Discovery Benchmark
 *
 * Connects to real relays and measures whether NIP-65 relay discovery
 * finds data that the 3 hardcoded defaults would miss.
 *
 * Usage: npx tsx tests/relay-discovery-benchmark.ts [hex_pubkey]
 *
 * What it measures:
 *   1. How many of your follows have kind:10002 relay lists?
 *   2. How many unique relays are discovered beyond the 3 defaults?
 *   3. For follows who declare personal relays, can we reach them there?
 *   4. Relay pool endorsement distribution
 */

import WebSocket from 'ws';
import { parseRelayListTags, RelayPool } from '../lib/sync.ts';
import type { RelayListEntry } from '../lib/types.ts';

// Polyfill WebSocket for our sync module (it expects browser WebSocket)
(globalThis as any).WebSocket = WebSocket;

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://nostr-01.yakihonne.com'];
const REQUEST_TIMEOUT = 8000;

// ── Helpers ──

function fetchFromRelay(
    relayUrl: string,
    filter: Record<string, unknown>
): Promise<Array<{ kind: number; tags: string[][]; created_at: number; pubkey: string }>> {
    return new Promise((resolve) => {
        const events: Array<{ kind: number; tags: string[][]; created_at: number; pubkey: string }> = [];
        let done = false;

        const finish = () => {
            if (done) return;
            done = true;
            try { ws.close(); } catch {}
            resolve(events);
        };

        const timer = setTimeout(finish, REQUEST_TIMEOUT);

        let ws: WebSocket;
        try {
            ws = new WebSocket(relayUrl);
        } catch {
            clearTimeout(timer);
            resolve([]);
            return;
        }

        const subId = 'bench_' + Math.random().toString(36).slice(2, 8);

        ws.on('open', () => {
            ws.send(JSON.stringify(['REQ', subId, filter]));
        });

        ws.on('message', (data: Buffer) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg[0] === 'EVENT' && msg[1] === subId) {
                    events.push(msg[2]);
                } else if (msg[0] === 'EOSE') {
                    clearTimeout(timer);
                    try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {}
                    finish();
                }
            } catch {}
        });

        ws.on('error', () => { clearTimeout(timer); finish(); });
        ws.on('close', () => { clearTimeout(timer); finish(); });
    });
}

async function fetchFromAllRelays(
    relays: string[],
    filter: Record<string, unknown>
): Promise<Array<{ kind: number; tags: string[][]; created_at: number; pubkey: string }>> {
    const results = await Promise.all(relays.map(r => fetchFromRelay(r, filter)));
    // Dedupe by pubkey+kind, keep newest
    const best = new Map<string, { kind: number; tags: string[][]; created_at: number; pubkey: string }>();
    for (const events of results) {
        for (const ev of events) {
            const key = `${ev.pubkey}:${ev.kind}`;
            const existing = best.get(key);
            if (!existing || ev.created_at > existing.created_at) {
                best.set(key, ev);
            }
        }
    }
    return Array.from(best.values());
}

// ── Main ──

async function main() {
    const rootPubkey = process.argv[2];
    if (!rootPubkey || !/^[0-9a-f]{64}$/.test(rootPubkey)) {
        console.error('Usage: npx tsx tests/relay-discovery-benchmark.ts <hex_pubkey>');
        console.error('  Provide your nostr pubkey in hex format (64 chars)');
        process.exit(1);
    }

    console.log('=== NIP-65 Relay Discovery Benchmark ===\n');
    console.log(`Root pubkey: ${rootPubkey}`);
    console.log(`Default relays: ${DEFAULT_RELAYS.join(', ')}\n`);

    // Step 1: Fetch root's follows (kind:3) and relay list (kind:10002)
    console.log('--- Step 1: Fetch root user data ---');
    const rootEvents = await fetchFromAllRelays(DEFAULT_RELAYS, {
        kinds: [3, 10002],
        authors: [rootPubkey],
        limit: 2
    });

    const rootKind3 = rootEvents.find(e => e.kind === 3);
    const rootKind10002 = rootEvents.find(e => e.kind === 10002);

    if (!rootKind3) {
        console.error('Could not fetch root kind:3 contact list. Is the pubkey correct?');
        process.exit(1);
    }

    const follows = rootKind3.tags.filter(t => t[0] === 'p' && t[1]).map(t => t[1]);
    console.log(`  Follows: ${follows.length}`);

    if (rootKind10002) {
        const rootRelays = parseRelayListTags(rootKind10002.tags);
        console.log(`  Root's relay list: ${rootRelays.length} relays`);
        for (const r of rootRelays) {
            const markers = [r.read ? 'read' : '', r.write ? 'write' : ''].filter(Boolean).join('+');
            console.log(`    ${r.url} (${markers})`);
        }
    } else {
        console.log('  Root has no kind:10002 relay list');
    }

    // Step 2: Fetch kind:10002 for follows (sample up to 50)
    console.log('\n--- Step 2: Fetch relay lists for follows ---');
    const sampleSize = Math.min(follows.length, 50);
    const sample = follows.slice(0, sampleSize);
    console.log(`  Sampling ${sampleSize} of ${follows.length} follows...`);

    // Batch fetch kind:10002 for all sampled follows
    const BATCH = 20;
    const allRelayListEvents: Array<{ kind: number; tags: string[][]; created_at: number; pubkey: string }> = [];

    for (let i = 0; i < sample.length; i += BATCH) {
        const batch = sample.slice(i, i + BATCH);
        const events = await fetchFromAllRelays(DEFAULT_RELAYS, {
            kinds: [10002],
            authors: batch,
            limit: batch.length
        });
        allRelayListEvents.push(...events);
        process.stdout.write(`  Fetched ${Math.min(i + BATCH, sample.length)}/${sampleSize}\r`);
    }
    console.log();

    const followsWithRelayList = new Set(allRelayListEvents.map(e => e.pubkey));
    console.log(`  Follows with kind:10002: ${followsWithRelayList.size}/${sampleSize} (${(followsWithRelayList.size / sampleSize * 100).toFixed(0)}%)`);

    // Step 3: Build relay pool and analyze
    console.log('\n--- Step 3: Relay pool analysis ---');
    const pool = new RelayPool();
    const allDiscoveredRelays = new Set<string>();
    const followRelayMap = new Map<string, RelayListEntry[]>();

    for (const ev of allRelayListEvents) {
        const relays = parseRelayListTags(ev.tags);
        followRelayMap.set(ev.pubkey, relays);
        pool.ingest(relays);
        for (const r of relays) {
            allDiscoveredRelays.add(r.url);
        }
    }

    const defaultSet = new Set(DEFAULT_RELAYS);
    const newRelays = [...allDiscoveredRelays].filter(url => !defaultSet.has(url));
    console.log(`  Total unique relays discovered: ${allDiscoveredRelays.size}`);
    console.log(`  New relays (not in defaults): ${newRelays.length}`);

    const topRelays = pool.getTopRelays(20);
    console.log(`\n  Top relays by endorsement count (min 2):`);
    for (const r of topRelays.slice(0, 20)) {
        const isDefault = defaultSet.has(r.url) ? ' [DEFAULT]' : ' [NEW]';
        console.log(`    ${r.endorsements.toString().padStart(3)}x  ${r.url}${isDefault}`);
    }

    // Step 4: Reachability test — pick follows whose ONLY write-relays are non-default
    console.log('\n--- Step 4: Reachability comparison ---');
    const onlyOnPersonalRelays: Array<{ pubkey: string; writeRelays: string[] }> = [];

    for (const [pubkey, relays] of followRelayMap) {
        const writeRelays = relays.filter(r => r.write).map(r => r.url);
        const onDefaults = writeRelays.some(url => defaultSet.has(url));
        if (!onDefaults && writeRelays.length > 0) {
            onlyOnPersonalRelays.push({ pubkey, writeRelays });
        }
    }

    console.log(`  Follows publishing ONLY to non-default relays: ${onlyOnPersonalRelays.length}`);

    if (onlyOnPersonalRelays.length > 0) {
        // Test: can we reach these users on their declared relays?
        const testSample = onlyOnPersonalRelays.slice(0, 5);
        console.log(`  Testing reachability for ${testSample.length} of them:\n`);

        for (const { pubkey, writeRelays } of testSample) {
            const shortPk = pubkey.slice(0, 12) + '...';

            // Try default relays
            const defaultResult = await fetchFromAllRelays(DEFAULT_RELAYS, {
                kinds: [0],
                authors: [pubkey],
                limit: 1
            });

            // Try their declared write-relays
            const personalResult = await fetchFromAllRelays(writeRelays, {
                kinds: [0],
                authors: [pubkey],
                limit: 1
            });

            const defaultFound = defaultResult.length > 0;
            const personalFound = personalResult.length > 0;

            let verdict = '';
            if (!defaultFound && personalFound) verdict = 'ONLY reachable via NIP-65 relay';
            else if (defaultFound && personalFound) verdict = 'reachable on both';
            else if (defaultFound && !personalFound) verdict = 'only on defaults (declared relay down?)';
            else verdict = 'unreachable on both';

            console.log(`    ${shortPk}  defaults:${defaultFound ? 'YES' : 'NO'}  personal:${personalFound ? 'YES' : 'NO'}  → ${verdict}`);
            console.log(`      write-relays: ${writeRelays.join(', ')}`);
        }
    }

    // Step 5: Summary
    console.log('\n--- Summary ---');
    const pctWithRelayList = (followsWithRelayList.size / sampleSize * 100).toFixed(0);
    console.log(`  ${pctWithRelayList}% of sampled follows have NIP-65 relay lists`);
    console.log(`  ${newRelays.length} relays discovered beyond the 3 defaults`);
    console.log(`  ${topRelays.length} relays meet the min-endorsement threshold (≥2)`);
    console.log(`  ${onlyOnPersonalRelays.length} follows publish ONLY to non-default relays`);

    if (onlyOnPersonalRelays.length > 0) {
        console.log(`\n  → These ${onlyOnPersonalRelays.length} users would be INVISIBLE without NIP-65 discovery`);
    }

    if (topRelays.length > 3) {
        console.log(`  → The relay pool would expand sync to ${Math.min(topRelays.length, 10)} connections (vs 3 hardcoded)`);
    }

    console.log('\nDone.');
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
