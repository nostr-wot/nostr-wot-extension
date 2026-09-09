/**
 * Names of the background's relay-answer caches.
 *
 * Duplicated deliberately rather than imported from `services/relays/relayCache.ts`: the
 * popup must not pull a background module (and its relay/socket dependencies)
 * into its bundle just to learn two strings.
 * `tests/relay-cache.test.ts` pins these against the background's own copy.
 */
export const PQC_PUBLISHED_CACHE = 'pqcPublishedV2';
export const MUTE_LIST_CACHE = 'muteList';
