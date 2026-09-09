import { RELAY_CACHE_PREFIX } from '@constants/relays.ts';
import { RELAY_CACHE_FRESH_MS } from '@constants/relays.ts';
export { RELAY_CACHE_FRESH_MS, PQC_PUBLISHED_CACHE, MUTE_LIST_CACHE } from '@constants/relays.ts';
/**
 * Serve the last known answer now; ask the relays behind.
 *
 * `docs/component-standards.md` §10: "No mount effect may open a socket. Relay
 * and NWC round trips on popup open put the slowest relay on the path to first
 * paint. Ask the background for a cached answer and let it refresh behind."
 *
 * Two home-screen cards were doing exactly that — the mute list and the
 * post-quantum published check — so opening the popup meant waiting out
 * `RELAY_TIMEOUT_MS` per read whenever a default relay was slow or down.
 *
 * The rule that keeps this honest: **an unreachable read is never cached, and
 * never overwrites a cached answer.** A cached value is therefore always
 * something the relays really said at some point — stale at worst, never
 * invented. That is the distinction the PQC handler's own comment exists to
 * protect: reporting "not published" to someone whose attestation is live tells
 * them to set it up again.
 *
 * The refresh writes through `browser.storage.local`, which every extension
 * context hears via `storage.onChanged` — including the popup that is already
 * open, which `runtime.sendMessage` cannot reach (§9 again).
 */

import browser from '../../lib/browser.ts';

/** Anything cached here can say it could not reach the relays. */
export interface MaybeUnreachable {
  unreachable?: boolean;
}

export interface CachedAnswer<T> {
  value: T;
  /** When the relays last actually answered. */
  fetchedAt: number;
}

/** `storage.local` key for a per-pubkey cached relay answer. */
export function cacheKey(name: string, pubkey: string): string {
  return `${RELAY_CACHE_PREFIX}${name}_${pubkey}`;
}

/** In-flight refreshes, so N popup opens in a row do not start N queries. */
const inFlight = new Map<string, Promise<unknown>>();
const revisions = new Map<string, number>();

/** An acknowledged publication supersedes any older refresh still in flight. */
export async function seedRelayCache<T>(name: string, pubkey: string, value: T): Promise<void> {
  const key = cacheKey(name, pubkey);
  revisions.set(key, (revisions.get(key) || 0) + 1);
  await browser.storage.local.set({ [key]: { value, fetchedAt: Date.now() } });
}

/**
 * Read `name` for `pubkey`: return the cached answer immediately when there is
 * one. Refresh only stale entries, writing storage when the answer lands.
 *
 * With no cache there is nothing to serve, so the first call still waits — a
 * one-time cost per account, not a cost on every popup open.
 */
export async function cachedRelayRead<T extends MaybeUnreachable>(
  name: string,
  pubkey: string,
  read: () => Promise<T>,
): Promise<T> {
  const key = cacheKey(name, pubkey);

  let cached: CachedAnswer<T> | undefined;
  try {
    const stored = await browser.storage.local.get(key) as Record<string, CachedAnswer<T>>;
    cached = stored[key];
  } catch { /* storage unavailable — fall through to a live read */ }

  // A storage notification causes the popup to read this value again. Without
  // this freshness check that read launches another refresh, whose fetchedAt
  // write triggers another notification: an unbounded relay-query loop.
  const age = cached ? Date.now() - cached.fetchedAt : Infinity;
  if (cached && age >= 0 && age < RELAY_CACHE_FRESH_MS) return cached.value;

  const refresh = () => {
    if (inFlight.has(key)) return inFlight.get(key)! as Promise<T>;
    const revision = revisions.get(key) || 0;
    const p = (async () => {
      const fresh = await read();
      // Never let a failed read evict a real answer.
      if (!fresh.unreachable && revision === (revisions.get(key) || 0)) {
        try {
          await browser.storage.local.set({ [key]: { value: fresh, fetchedAt: Date.now() } });
        } catch { /* best effort: the value is still returned to this caller */ }
      }
      return fresh;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  };

  if (cached) {
    // Stale only. Behind, not awaited: this is the whole point. The popup paints from the
    // cache and `storage.onChanged` corrects it a moment later.
    void refresh().catch(() => {});
    return cached.value;
  }

  return await refresh();
}

/** Drop every cached answer for a pubkey — used when an account is removed. */
export async function clearRelayCache(pubkey: string, names: string[]): Promise<void> {
  for (const name of names) {
    const key = cacheKey(name, pubkey);
    revisions.set(key, (revisions.get(key) || 0) + 1);
  }
  try {
    await browser.storage.local.remove(names.map((n) => cacheKey(n, pubkey)));
  } catch { /* nothing to do */ }
}
