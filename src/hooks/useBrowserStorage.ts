import { useEffect, useRef, useState } from 'react';
import browser from '@lib/browser.ts';

type StorageArea = 'local' | 'sync' | 'session';

/**
 * Read a `browser.storage` key and stay in sync with it for the life of the
 * popup.
 *
 * Documented in docs/component-standards.md long before it existed — two
 * components (RelaysRow, GlobeButton) had each hand-rolled this exact effect
 * rather than finding it. `storage.onChanged`, not a runtime message, per
 * docs §9: a message never reaches the tab that sent it, so a popup cannot
 * notify itself of its own write, while a storage change reaches every
 * context including the writer.
 *
 * Filter on `area` — most keys are `local`, but `relays` is `sync`, and a
 * listener that ignores the area reacts to a same-named key in the wrong
 * store.
 *
 * A failed `get()` leaves the current value alone instead of falling back to
 * `defaultValue`: collapsing "the read failed" into "the read succeeded and
 * found nothing" is the mistake docs §9 calls out (a failed read is unknown,
 * not a negative answer). Callers for whom that distinction matters should
 * pick a `defaultValue` that already means "nothing known yet".
 */
export default function useBrowserStorage<T>(key: string, defaultValue: T, area: StorageArea = 'local'): T {
  const [value, setValue] = useState<T>(defaultValue);

  // Held in a ref, not read fresh from the closure: the effect below only
  // re-subscribes when `key`/`area` change, so a `defaultValue` recreated
  // inline on every render (a new array or object literal) must not tear the
  // listener down and rebuild it — the trap useRelayCache and useOutsideClick
  // avoid the same way.
  const defaultRef = useRef(defaultValue);
  defaultRef.current = defaultValue;

  useEffect(() => {
    let cancelled = false;

    const read = () => {
      browser.storage[area].get([key])
        .then((data: Record<string, unknown>) => {
          if (cancelled) return;
          setValue(key in data ? (data[key] as T) : defaultRef.current);
        })
        .catch(() => {}); // leave `value` as it is — see the note above
    };
    read();

    const onChanged = (changes: Record<string, unknown>, changedArea: string) => {
      if (changedArea === area && key in changes) read();
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, [key, area]);

  return value;
}
