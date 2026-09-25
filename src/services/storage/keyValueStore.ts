/**
 * `browser.storage` as the `@nostr-wot/storage` port.
 *
 * Every shared package persists through `KeyValueStore` and knows nothing else, so this
 * file is the single place where "extension storage" is spelled out. It is deliberately
 * the whole of the platform coupling: `@nostr-wot/permissions`, `@nostr-wot/vault` and
 * `@nostr-wot/signer-core` run unchanged on a phone because they receive one of these
 * rather than reaching for `chrome.storage` themselves.
 *
 * Key names are NOT namespaced. That is a decision, not an oversight: the packages use the
 * extension's own key names (`signerPermissions`, `keyVault`, `_permMigrationVersion`) so
 * that a user who updates finds their existing data, and `namespaced()` would present every
 * one of them with an empty vault and a "create one" screen while their keys sat in storage
 * under the old name. `_permMigrationVersion` in particular is written at the store's top
 * level by `@nostr-wot/permissions`, so a namespaced view would not share it with the
 * permission tree it is versioning.
 *
 * @module services/storage/keyValueStore
 */
import type { KeyValueStore } from '@nostr-wot/storage';
import browser from '@lib/browser.ts';

/** Which `browser.storage` area a store reads and writes. */
export type StorageArea = 'local' | 'session';

/**
 * A change listener, registered once per process rather than once per store.
 *
 * `browser.storage.onChanged` is a single global event covering every area, and MV3 caps
 * how many listeners an extension may add. One fan-out here means any number of stores and
 * package instances can subscribe without each one costing a listener registration — and
 * without any of them having to know which area the event came from.
 */
type AreaListener = (key: string) => void;
const listenersByArea = new Map<StorageArea, Set<AreaListener>>();
let installed = false;

function installChangeListener(): void {
  if (installed) return;
  installed = true;
  try {
    browser.storage.onChanged.addListener((changes: Record<string, unknown>, area: string) => {
      const listeners = listenersByArea.get(area as StorageArea);
      if (!listeners) return;
      for (const key of Object.keys(changes)) {
        // One listener throwing must not cost the others their notification: a stale
        // permission cache is an authorization bug, not a cosmetic one.
        for (const listener of listeners) {
          try { listener(key); } catch { /* keep notifying */ }
        }
      }
    });
  } catch {
    // No `storage.onChanged` here — a bare `node --test`, a restricted frame. Stores still
    // work; they just cache blindly and rely on their own writes to invalidate.
    installed = false;
  }
}

/**
 * A {@link KeyValueStore} over one `browser.storage` area.
 *
 * `browser.storage` is already a value store: it structured-clones on the way in and out in
 * a real browser, so what a `get` returns is unaffected by later mutation of what was
 * `set`, which is what the port requires. The test mock does not clone, but every package
 * that mutates works on its own copy before writing, so nothing depends on the difference.
 */
export function extensionStore(area: StorageArea = 'local'): KeyValueStore {
  const backing = () => (browser.storage as unknown as Record<StorageArea, chrome.storage.StorageArea>)[area];

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const data = await backing().get(key) as Record<string, T>;
      return data[key];
    },
    async set<T>(key: string, value: T): Promise<void> {
      await backing().set({ [key]: value });
    },
    async remove(key: string): Promise<void> {
      await backing().remove(key);
    },
    async keys(): Promise<string[]> {
      // `get(null)` is the only way to enumerate an extension storage area, so this reads
      // everything in it. Callers in the shared packages use `keys()` rarely and never on a
      // request path; if that changes, this is the line that will need a stored index.
      const all = await backing().get(null) as Record<string, unknown>;
      return Object.keys(all);
    },
    subscribe(listener: AreaListener): () => void {
      installChangeListener();
      let listeners = listenersByArea.get(area);
      if (!listeners) {
        listeners = new Set();
        listenersByArea.set(area, listeners);
      }
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/**
 * The one `local`-area store the extension's shared-package instances share.
 *
 * A module singleton because the things built on it are singletons: one `Permissions`, one
 * `Vault`, one signing pipeline, all over the same physical storage. Separate instances
 * would be correct but would each keep their own cache of the same keys, and two caches of
 * an authorization decision is precisely the bug the `subscribe` wiring exists to prevent.
 */
export const localStore: KeyValueStore = extensionStore('local');
