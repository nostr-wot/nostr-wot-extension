// Cross-browser compatibility layer
// Works with Chrome (chrome.*), Firefox (browser.*), and Safari
// Firefox natively supports the browser.* API, Chrome needs the chrome.* API
// Safari lacks storage.session — polyfill it with storage.local using a prefix

// Read off globalThis rather than naming `browser`/`chrome` as bare
// identifiers. A bare name that is not defined is a ReferenceError, thrown at
// module load, before this module does anything at all — so any context
// without the extension globals (a plain `node --test`, a restricted frame)
// could not import it even to reach a function that never touches the API.
// That fragility is why two hand-rolled copies of this shim existed elsewhere,
// each with its own idea of how to dodge it.
const globals = globalThis as Record<string, unknown>;
const browserAPI = (globals.browser ?? globals.chrome) as typeof chrome;

// Safari doesn't support storage.session — shim it onto storage.local with a key prefix.
//
// Guarded on `storage` existing at all, not just on `session`. This module is
// imported for its default export by UI code that may never touch storage, and
// in any context without the storage permission — a bare test, a content script
// in a restricted frame — reading `.session` off an undefined `storage` throws
// at import time and takes the whole module down with it.
if (browserAPI?.storage && !browserAPI.storage.session) {
  const PREFIX = '__session__';
  (browserAPI.storage as typeof chrome.storage).session = {
    get: (keys: string | string[] | Record<string, unknown> | null) => {
      if (keys === null) return browserAPI.storage.local.get(null).then((all: Record<string, unknown>) => {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(all)) {
          if (k.startsWith(PREFIX)) result[k.slice(PREFIX.length)] = v;
        }
        return result;
      });
      const keyList = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys!);
      const prefixed = keyList.map(k => PREFIX + k);
      return browserAPI.storage.local.get(prefixed).then((data: Record<string, unknown>) => {
        const result: Record<string, unknown> = {};
        for (const k of keyList) {
          if ((PREFIX + k) in data) result[k] = data[PREFIX + k];
        }
        return result;
      });
    },
    set: (items: Record<string, unknown>) => {
      const prefixed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(items)) prefixed[PREFIX + k] = v;
      return browserAPI.storage.local.set(prefixed);
    },
    remove: (keys: string | string[]) => {
      const keyList = typeof keys === 'string' ? [keys] : keys;
      return browserAPI.storage.local.remove(keyList.map(k => PREFIX + k));
    },
    clear: () => {
      return browserAPI.storage.local.get(null).then((all: Record<string, unknown>) => {
        const sessionKeys = Object.keys(all).filter(k => k.startsWith(PREFIX));
        if (sessionKeys.length) return browserAPI.storage.local.remove(sessionKeys);
      });
    },
    onChanged: browserAPI.storage.local.onChanged,
  } as unknown as typeof chrome.storage.session;
}

export default browserAPI;
