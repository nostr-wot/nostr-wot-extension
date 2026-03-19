/**
 * Relay Discovery Tests — Pure Function Coverage
 *
 * Tests for parseRelayListTags and RelayPool from lib/sync.ts.
 * No browser mock needed — these are pure functions.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseRelayListTags, RelayPool, normalizeRelayUrl } from '../lib/sync.ts';
import { MAX_RELAYS_PER_EVENT } from '../lib/constants.ts';

// ── normalizeRelayUrl ──

describe('normalizeRelayUrl', () => {
    it('strips trailing slash', () => {
        assert.equal(normalizeRelayUrl('wss://relay.damus.io/'), 'wss://relay.damus.io');
    });

    it('strips multiple trailing slashes', () => {
        assert.equal(normalizeRelayUrl('wss://relay.damus.io///'), 'wss://relay.damus.io');
    });

    it('lowercases the URL', () => {
        assert.equal(normalizeRelayUrl('WSS://Relay.Damus.IO'), 'wss://relay.damus.io');
    });

    it('lowercases and strips trailing slash together', () => {
        assert.equal(normalizeRelayUrl('WSS://NOS.LOL/'), 'wss://nos.lol');
    });

    it('preserves meaningful paths', () => {
        assert.equal(normalizeRelayUrl('wss://relay.example.com/inbox'), 'wss://relay.example.com/inbox');
    });

    it('leaves already-normalized URLs unchanged', () => {
        assert.equal(normalizeRelayUrl('wss://relay.damus.io'), 'wss://relay.damus.io');
    });
});

// ── parseRelayListTags ──

describe('parseRelayListTags', () => {
    it('parses r-tags with no marker as read+write', () => {
        const tags = [['r', 'wss://relay.damus.io']];
        const result = parseRelayListTags(tags);
        assert.equal(result.length, 1);
        assert.deepStrictEqual(result[0], {
            url: 'wss://relay.damus.io',
            read: true,
            write: true
        });
    });

    it('parses r-tags with read marker', () => {
        const tags = [['r', 'wss://relay.damus.io', 'read']];
        const result = parseRelayListTags(tags);
        assert.equal(result.length, 1);
        assert.deepStrictEqual(result[0], {
            url: 'wss://relay.damus.io',
            read: true,
            write: false
        });
    });

    it('parses r-tags with write marker', () => {
        const tags = [['r', 'wss://relay.damus.io', 'write']];
        const result = parseRelayListTags(tags);
        assert.equal(result.length, 1);
        assert.deepStrictEqual(result[0], {
            url: 'wss://relay.damus.io',
            read: false,
            write: true
        });
    });

    it('parses mixed markers correctly', () => {
        const tags = [
            ['r', 'wss://relay.damus.io'],
            ['r', 'wss://nos.lol', 'read'],
            ['r', 'wss://relay.snort.social', 'write'],
        ];
        const result = parseRelayListTags(tags);
        assert.equal(result.length, 3);
        assert.deepStrictEqual(result[0], { url: 'wss://relay.damus.io', read: true, write: true });
        assert.deepStrictEqual(result[1], { url: 'wss://nos.lol', read: true, write: false });
        assert.deepStrictEqual(result[2], { url: 'wss://relay.snort.social', read: false, write: true });
    });

    it('rejects non-wss:// URLs', () => {
        const tags = [
            ['r', 'ws://insecure.relay.com'],
            ['r', 'http://not-a-relay.com'],
            ['r', 'wss://valid.relay.com'],
            ['r', 'ftp://bad.relay.com'],
        ];
        const result = parseRelayListTags(tags);
        assert.equal(result.length, 1);
        assert.equal(result[0].url, 'wss://valid.relay.com');
    });

    it('caps at MAX_RELAYS_PER_EVENT', () => {
        const tags: string[][] = [];
        for (let i = 0; i < 30; i++) {
            tags.push(['r', `wss://relay${i}.example.com`]);
        }
        const result = parseRelayListTags(tags);
        assert.equal(result.length, MAX_RELAYS_PER_EVENT);
    });

    it('handles empty tags array', () => {
        const result = parseRelayListTags([]);
        assert.equal(result.length, 0);
    });

    it('skips non-r tags', () => {
        const tags = [
            ['p', 'abc123'],
            ['e', 'event123'],
            ['r', 'wss://relay.damus.io'],
        ];
        const result = parseRelayListTags(tags);
        assert.equal(result.length, 1);
        assert.equal(result[0].url, 'wss://relay.damus.io');
    });

    it('skips r-tags with missing URL', () => {
        const tags = [
            ['r'],
            ['r', ''],
            ['r', 'wss://relay.damus.io'],
        ];
        const result = parseRelayListTags(tags);
        assert.equal(result.length, 1);
        assert.equal(result[0].url, 'wss://relay.damus.io');
    });

    it('normalizes trailing slashes', () => {
        const tags = [['r', 'wss://relay.damus.io/']];
        const result = parseRelayListTags(tags);
        assert.equal(result[0].url, 'wss://relay.damus.io');
    });

    it('normalizes uppercase URLs', () => {
        const tags = [['r', 'WSS://NOS.LOL/']];
        const result = parseRelayListTags(tags);
        assert.equal(result[0].url, 'wss://nos.lol');
    });

    it('deduplicates URLs that differ only by trailing slash', () => {
        const tags = [
            ['r', 'wss://relay.damus.io'],
            ['r', 'wss://relay.damus.io/'],
            ['r', 'wss://nos.lol'],
        ];
        const result = parseRelayListTags(tags);
        assert.equal(result.length, 2);
        assert.equal(result[0].url, 'wss://relay.damus.io');
        assert.equal(result[1].url, 'wss://nos.lol');
    });

    it('deduplicates URLs that differ only by case', () => {
        const tags = [
            ['r', 'wss://relay.damus.io'],
            ['r', 'WSS://RELAY.DAMUS.IO'],
        ];
        const result = parseRelayListTags(tags);
        assert.equal(result.length, 1);
    });
});

// ── RelayPool ──

describe('RelayPool', () => {
    it('counts endorsements from write-relays', () => {
        const pool = new RelayPool();
        pool.ingest([
            { url: 'wss://relay.damus.io', read: true, write: true },
            { url: 'wss://nos.lol', read: true, write: true },
        ]);
        pool.ingest([
            { url: 'wss://relay.damus.io', read: true, write: true },
            { url: 'wss://relay.snort.social', read: true, write: true },
        ]);

        assert.equal(pool.endorsements.get('wss://relay.damus.io'), 2);
        assert.equal(pool.endorsements.get('wss://nos.lol'), 1);
        assert.equal(pool.endorsements.get('wss://relay.snort.social'), 1);
    });

    it('ignores read-only relays for endorsements', () => {
        const pool = new RelayPool();
        pool.ingest([
            { url: 'wss://relay.damus.io', read: true, write: false },
            { url: 'wss://nos.lol', read: false, write: true },
        ]);
        pool.ingest([
            { url: 'wss://relay.damus.io', read: true, write: false },
            { url: 'wss://nos.lol', read: false, write: true },
        ]);

        assert.equal(pool.endorsements.has('wss://relay.damus.io'), false);
        assert.equal(pool.endorsements.get('wss://nos.lol'), 2);
    });

    it('getTopRelays filters by min endorsements', () => {
        const pool = new RelayPool();
        // Only relay.damus.io gets 2 endorsements (meets threshold)
        pool.ingest([{ url: 'wss://relay.damus.io', read: true, write: true }]);
        pool.ingest([{ url: 'wss://relay.damus.io', read: true, write: true }]);
        pool.ingest([{ url: 'wss://one-endorsement.com', read: true, write: true }]);

        const top = pool.getTopRelays(10);
        assert.equal(top.length, 1);
        assert.equal(top[0].url, 'wss://relay.damus.io');
        assert.equal(top[0].endorsements, 2);
    });

    it('getTopRelays sorts by endorsement count descending', () => {
        const pool = new RelayPool();
        for (let i = 0; i < 5; i++) {
            pool.ingest([{ url: 'wss://popular.relay.com', read: true, write: true }]);
        }
        for (let i = 0; i < 3; i++) {
            pool.ingest([{ url: 'wss://medium.relay.com', read: true, write: true }]);
        }
        for (let i = 0; i < 2; i++) {
            pool.ingest([{ url: 'wss://threshold.relay.com', read: true, write: true }]);
        }

        const top = pool.getTopRelays(10);
        assert.equal(top.length, 3);
        assert.equal(top[0].url, 'wss://popular.relay.com');
        assert.equal(top[0].endorsements, 5);
        assert.equal(top[1].url, 'wss://medium.relay.com');
        assert.equal(top[1].endorsements, 3);
        assert.equal(top[2].url, 'wss://threshold.relay.com');
        assert.equal(top[2].endorsements, 2);
    });

    it('getTopRelays respects n limit', () => {
        const pool = new RelayPool();
        for (let i = 0; i < 10; i++) {
            const relays = [];
            for (let j = 0; j < 5; j++) {
                relays.push({ url: `wss://relay${j}.example.com`, read: true, write: true });
            }
            pool.ingest(relays);
        }

        const top = pool.getTopRelays(3);
        assert.equal(top.length, 3);
    });

    it('getTopRelays caps at RELAY_POOL_MAX_SIZE', () => {
        const pool = new RelayPool();
        // Create 60 relays each with 2+ endorsements
        for (let round = 0; round < 3; round++) {
            const relays = [];
            for (let i = 0; i < 60; i++) {
                relays.push({ url: `wss://relay${i}.example.com`, read: true, write: true });
            }
            pool.ingest(relays);
        }

        const top = pool.getTopRelays(100);
        assert.ok(top.length <= 50, `Expected at most 50 relays, got ${top.length}`);
    });

    it('returns empty array when no relays meet threshold', () => {
        const pool = new RelayPool();
        pool.ingest([{ url: 'wss://lonely.relay.com', read: true, write: true }]);

        const top = pool.getTopRelays(10);
        assert.equal(top.length, 0);
    });
});
