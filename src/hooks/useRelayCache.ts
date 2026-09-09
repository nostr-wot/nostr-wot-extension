import { RELAY_CACHE_PREFIX } from '@constants/relays.ts';
import { useEffect, useRef } from 'react';
import browser from '@lib/browser.ts';

/**
 * Re-read a relay-backed value when the background finishes refreshing it.
 *
 * The background serves these cached-first so the popup paints without waiting
 * on a relay (`services/relays/relayCache.ts`), then asks the relays behind and writes
 * the answer to `storage.local`. This is the other half: the open popup hears
 * that write and corrects itself.
 *
 * `storage.onChanged` rather than a runtime message, per
 * docs/component-standards.md §10 — a background broadcast only reaches a popup
 * that was already open, and a popup cannot notify itself. Storage changes
 * reach every context.
 */
export default function useRelayCache(name: string, onRefreshed: () => void): void {
  // Held in a ref, not a dependency: callers pass an inline closure, and
  // re-subscribing on every render would tear the listener down and rebuild it
  // constantly — the trap documented in §9 and in ApprovalOverlay.
  const onRefreshedRef = useRef(onRefreshed);
  onRefreshedRef.current = onRefreshed;

  useEffect(() => {
    const prefix = `${RELAY_CACHE_PREFIX}${name}_`;
    const listener = (changes: Record<string, unknown>, area: string) => {
      // The cache is per-pubkey, so match the family rather than one key: the
      // account can switch while the popup is open.
      if (area === 'local' && Object.keys(changes).some((k) => k.startsWith(prefix))) {
        onRefreshedRef.current();
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, [name]);
}
