import { useEffect, useRef } from 'react';
import browser from '@lib/browser.ts';

export type StorageArea = 'local' | 'sync' | 'session';

export interface StorageWatchMatcher {
  area: StorageArea;
  keys: string[];
}

/**
 * Re-run `onChange` when `browser.storage.onChanged` touches one of the given
 * (area, key) pairs.
 *
 * `storage.onChanged`, not `runtime.sendMessage`: a popup cannot notify
 * itself of its own write (a runtime message never reaches the tab that sent
 * it), but a storage change reaches every context including the writer
 * (docs/component-standards.md §10). Filtering by area is not optional — most
 * keys are `local`, but `relays` lives in `sync`, and a listener that only
 * checks one area silently misses writes to the other. `RelaysContext`
 * watches both at once, which is why this takes a list of matchers rather
 * than a single area.
 */
export default function useStorageWatch(matchers: StorageWatchMatcher[], onChange: () => void): void {
  // Held in refs, not read fresh from the closure: callers pass a fresh
  // array/closure on every render, and re-subscribing on every render would
  // tear the listener down and rebuild it constantly — the trap
  // `useRelayCache` and `useBrowserStorage` both document.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const matchersRef = useRef(matchers);
  matchersRef.current = matchers;
  // A stable string key derives the effect's real dependency (which areas
  // and keys are actually being watched) from an array literal that changes
  // identity every render.
  const matchersKey = matchers.map((m) => `${m.area}:${m.keys.join(',')}`).join('|');

  useEffect(() => {
    const listener = (changes: Record<string, unknown>, area: string) => {
      const hit = matchersRef.current.some(
        (m) => m.area === area && m.keys.some((k) => k in changes),
      );
      if (hit) onChangeRef.current();
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchersKey]);
}
