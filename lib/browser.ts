// Cross-browser compatibility layer
// Works with Chrome (chrome.*), Firefox (browser.*), and Safari
// Firefox natively supports the browser.* API, Chrome needs the chrome.* API
// Safari lacks storage.session — polyfill it with storage.local using a prefix

declare const browser: typeof chrome;

const browserAPI: typeof chrome = typeof browser !== 'undefined' ? browser : chrome;

// Safari doesn't support storage.session — shim it onto storage.local with a key prefix
if (!browserAPI.storage.session) {
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
