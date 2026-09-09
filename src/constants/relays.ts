// ── Constants ──

/* nos.lol first: relay.damus.io led this list and is the one that stalls most
   often, and every read here tries relays in order, so a slow first entry sits
   on the popup's path before anything else can answer. */
export const DEFAULT_RELAYS = ['wss://nos.lol', 'wss://relay.damus.io', 'wss://nostr-01.yakihonne.com'];

/** Text-field representation derived from the canonical relay list. */
export const DEFAULT_RELAYS_CSV = DEFAULT_RELAYS.join(',');

/** Shared by cache writers and UI watchers without importing background services. */
export const PQC_PUBLISHED_CACHE = 'pqcPublishedV2';

export const MUTE_LIST_CACHE = 'muteList';

/** Reuse recent answers across popup reads and cache-change notifications. */
export const RELAY_CACHE_FRESH_MS = 60_000;

export const RELAY_TIMEOUT_MS = 4000;

export const NIP46_RELAYS = ['wss://relay.nsec.app', ...DEFAULT_RELAYS];
export const RELAY_CACHE_PREFIX = 'relayCache_';
