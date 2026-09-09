/**
 * Miscellaneous handlers: activity log, NIP-51 mute list,
 * profile metadata, NIP-46 sessions, relay/event publishing, health checks.
 *
 * This module combines the focused RPC handler maps:
 *   - activity-handlers.ts  — activity log
 *   - profile-handlers.ts   — profile metadata, NIP-51 mute list (kind:10000)
 *   - publish-handlers.ts   — broadcasting, signing, mute-list publish, NIP-46 sessions, health checks
 *
 * @module services/background/misc-handlers
 */

import type { HandlerFn } from './state.ts';

import { handlers as activityHandlers } from './activity-handlers.ts';
import { handlers as profileHandlers } from './profile-handlers.ts';
import { handlers as publishHandlers } from './publish-handlers.ts';

import { handlers as relayListHandlers } from './relay-list-handlers.ts';

// Combined handlers map — contains ALL handlers from the focused modules
const handlers = new Map<string, HandlerFn>();
for (const group of [activityHandlers, profileHandlers, publishHandlers, relayListHandlers]) {
    for (const [k, v] of group) handlers.set(k, v);
}
export { handlers };
