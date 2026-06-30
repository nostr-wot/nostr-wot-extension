/**
 * Relay-list (NIP-65 / outbox) query handlers.
 *
 * These are page-facing, UNPRIVILEGED RPCs (exposed on window.nostr.wot for
 * relay discovery). They read relay lists previously stored in IndexedDB. The
 * trust-graph that used to populate this data has been removed, so in practice
 * these now return empty results until/unless relay lists are stored by some
 * other path — but the API surface is kept so relay-aware clients don't break.
 * @module lib/bg/relay-handlers
 */

import * as storage from '../storage.ts';
import { config, type HandlerFn } from './state.ts';

export const handlers = new Map<string, HandlerFn>([
    ['getRelayList', async (params) => storage.getRelayList(params.pubkey as string)],

    ['getRelayPool', async () => {
        if (!config.myPubkey) throw new Error('My pubkey not configured');

        // Compute endorsement counts from stored relay lists of user's follows
        const follows = await storage.getFollows(config.myPubkey);
        const endorsements = new Map<string, number>();

        for (const followPk of follows) {
            const relayList = storage.getRelayList(followPk);
            if (!relayList) continue;
            for (const entry of relayList) {
                if (!entry.write) continue;
                const count = endorsements.get(entry.url) || 0;
                endorsements.set(entry.url, count + 1);
            }
        }

        return Array.from(endorsements.entries())
            .map(([url, count]) => ({ url, endorsements: count }))
            .sort((a, b) => b.endorsements - a.endorsements)
            .slice(0, 50);
    }],
]);
