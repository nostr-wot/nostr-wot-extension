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

export const RELAY_POOL_IDLE_MS = 500;
export const MAX_RELAY_CONNECTIONS = 64;
export const MAX_RELAY_LEASES = 128;
export const MAX_RELAY_FRAME_BYTES = 1024 * 1024;
export const MAX_RELAY_QUERY_BYTES = 16 * 1024 * 1024;
export const MAX_RELAY_QUERY_EVENTS = 5000;
export const MAX_RELAY_QUEUE = 1024;
export const MAX_RELAY_AUTH_CHALLENGE_LENGTH = 4096;
export const MAX_RECONCILIATION_LOCAL_EVENTS = 50000;
export const MAX_RECONCILIATION_MISSING_IDS = 5000;

/** Bound waiting for a challenge or AUTH acknowledgment independently of the read. */
export const RELAY_AUTH_TIMEOUT_MS = 3000;
