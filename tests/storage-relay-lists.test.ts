/**
 * Relay List Storage Tests
 *
 * Tests for relay list CRUD in lib/storage.ts.
 * Uses fake-indexeddb to provide IndexedDB in Node.js.
 */

import 'fake-indexeddb/auto';
import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import * as storage from '../lib/storage.ts';
import type { RelayListEntry } from '../lib/types.ts';

const TEST_ACCOUNT_ID = 'test-account-relay';

describe('storage relay lists', () => {
    beforeEach(async () => {
        // Re-init with a fresh account each time
        await storage.initDB(TEST_ACCOUNT_ID + '-' + Math.random().toString(36).slice(2));
    });

    it('saveRelayList + getRelayList round-trip', async () => {
        const pubkey = 'a'.repeat(64);
        const relays: RelayListEntry[] = [
            { url: 'wss://relay.damus.io', read: true, write: true },
            { url: 'wss://nos.lol', read: true, write: false },
            { url: 'wss://relay.snort.social', read: false, write: true },
        ];

        storage.saveRelayList(pubkey, relays);
        const result = storage.getRelayList(pubkey);

        assert.deepStrictEqual(result, relays);
    });

    it('getRelayList returns null for unknown pubkeys', () => {
        const result = storage.getRelayList('b'.repeat(64));
        assert.equal(result, null);
    });

    it('getRelayListCount returns correct count', () => {
        const pk1 = 'c'.repeat(64);
        const pk2 = 'd'.repeat(64);

        storage.saveRelayList(pk1, [{ url: 'wss://r1.example.com', read: true, write: true }]);
        storage.saveRelayList(pk2, [{ url: 'wss://r2.example.com', read: true, write: true }]);

        assert.equal(storage.getRelayListCount(), 2);
    });

    it('saveRelayList overwrites previous entry', () => {
        const pubkey = 'e'.repeat(64);
        storage.saveRelayList(pubkey, [{ url: 'wss://old.relay.com', read: true, write: true }]);
        storage.saveRelayList(pubkey, [{ url: 'wss://new.relay.com', read: true, write: false }]);

        const result = storage.getRelayList(pubkey);
        assert.equal(result!.length, 1);
        assert.equal(result![0].url, 'wss://new.relay.com');
    });

    it('clearAll clears relay lists', async () => {
        const pubkey = 'f'.repeat(64);
        storage.saveRelayList(pubkey, [{ url: 'wss://r.example.com', read: true, write: true }]);

        await storage.clearAll();

        // After clearAll, getRelayList won't find the pubkey (caches cleared, ID mappings gone)
        assert.equal(storage.getRelayListCount(), 0);
    });

    it('relayListCount appears in getStats', async () => {
        const pubkey = '1'.repeat(64);
        storage.saveRelayList(pubkey, [{ url: 'wss://r.example.com', read: true, write: true }]);

        const stats = await storage.getStats();
        assert.equal(stats.relayListCount, 1);
    });

    it('flushWriteBuffer persists relay lists to DB', async () => {
        const pubkey = '2'.repeat(64);
        const relays: RelayListEntry[] = [
            { url: 'wss://relay.damus.io', read: true, write: true },
        ];

        storage.saveRelayList(pubkey, relays);
        await storage.flushWriteBuffer();

        // Verify from memory (still accessible after flush)
        const result = storage.getRelayList(pubkey);
        assert.deepStrictEqual(result, relays);
    });
});
