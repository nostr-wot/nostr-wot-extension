/**
 * Pure relay URL helpers used by the relay (NIP-65 / outbox) feature.
 * Extracted from the removed trust-graph sync module so the relay-list
 * functionality keeps working without the deprecated WoT subsystem.
 * @module lib/relayUtils
 */

/** Normalize relay URL: strip trailing slash, lowercase. */
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
