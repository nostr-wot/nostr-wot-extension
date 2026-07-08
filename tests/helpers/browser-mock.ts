/**
 * Mock browser.storage API for testing vault, permissions, and accounts.
 * Provides in-memory storage that behaves like chrome.storage.local/sync/session.
 */

interface StorageData {
  [key: string]: any;
}

interface StorageArea {
  get(keys?: string | string[] | null): Promise<StorageData>;
  set(items: StorageData): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
  _data: () => StorageData;
  _reset: () => void;
}

function createStorageArea(): StorageArea {
  let data: StorageData = {};
  return {
    get(keys?: string | string[] | null): Promise<StorageData> {
      if (typeof keys === 'string') keys = [keys];
      if (!keys) return Promise.resolve({ ...data });
      const result: StorageData = {};
      for (const k of keys) {
        if (k in data) result[k] = data[k];
      }
      return Promise.resolve(result);
    },
    set(items: StorageData): Promise<void> {
      Object.assign(data, items);
      return Promise.resolve();
    },
    remove(keys: string | string[]): Promise<void> {
      if (typeof keys === 'string') keys = [keys];
      for (const k of keys) delete data[k];
      return Promise.resolve();
    },
    clear(): Promise<void> {
      data = {};
      return Promise.resolve();
    },
    _data: () => data,
    _reset: () => { data = {}; }
  };
}

const local = createStorageArea();
const sync = createStorageArea();
const session = createStorageArea();

// Minimal chrome.alarms stub for keep-alive tests.
const _alarms = new Map<string, { periodInMinutes?: number }>();
type AlarmListener = (alarm: { name: string }) => void;
const _alarmListeners: AlarmListener[] = [];
const alarms = {
  create: (name: string, info?: { periodInMinutes?: number }) => { _alarms.set(name, info || {}); },
  clear: (name: string) => Promise.resolve(_alarms.delete(name)),
  get: (name: string) => Promise.resolve(_alarms.get(name)),
  onAlarm: {
    addListener: (fn: AlarmListener) => { _alarmListeners.push(fn); },
    removeListener: (fn: AlarmListener) => {
      const i = _alarmListeners.indexOf(fn);
      if (i >= 0) _alarmListeners.splice(i, 1);
    },
  },
  /** Test helper: true if an alarm with this name is currently armed. */
  _has: (name: string) => _alarms.has(name),
  _reset: () => { _alarms.clear(); _alarmListeners.length = 0; },
};

/** Test helper: whether a named alarm is currently armed (e.g. 'vault-keepalive'). */
export function hasAlarm(name: string): boolean {
  return _alarms.has(name);
}

// storage.onChanged listener support
type ChangeListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
const changeListeners: ChangeListener[] = [];

function fireOnChanged(changes: Record<string, { newValue?: unknown }>, area: string): void {
  for (const fn of changeListeners) {
    try { fn(changes, area); } catch { /* ignore */ }
  }
}

// Wrap set/remove/clear to fire onChanged for each storage area
function wrapWithOnChanged(area: StorageArea, areaName: string): void {
  const origSet = area.set.bind(area);
  const origRemove = area.remove.bind(area);
  const origClear = area.clear.bind(area);

  area.set = async (items: StorageData): Promise<void> => {
    await origSet(items);
    const changes: Record<string, { newValue?: unknown }> = {};
    for (const k of Object.keys(items)) changes[k] = { newValue: items[k] };
    fireOnChanged(changes, areaName);
  };
  area.remove = async (keys: string | string[]): Promise<void> => {
    await origRemove(keys);
    const arr = typeof keys === 'string' ? [keys] : keys;
    const changes: Record<string, { newValue?: unknown }> = {};
    for (const k of arr) changes[k] = {};
    fireOnChanged(changes, areaName);
  };
  area.clear = async (): Promise<void> => {
    await origClear();
    fireOnChanged({}, areaName);
  };
}

wrapWithOnChanged(local, 'local');
wrapWithOnChanged(sync, 'sync');
wrapWithOnChanged(session, 'session');

const mock = {
  alarms,
  storage: {
    local,
    sync,
    session,
    onChanged: {
      addListener: (fn: ChangeListener) => { changeListeners.push(fn); },
      removeListener: (fn: ChangeListener) => {
        const idx = changeListeners.indexOf(fn);
        if (idx >= 0) changeListeners.splice(idx, 1);
      },
    },
  },
  runtime: {
    getURL: (path: string) => `chrome-extension://test-id/${path}`,
    id: 'test-extension-id',
    sendMessage: () => Promise.resolve(),
    onMessage: { addListener: () => {} }
  },
  action: {
    setBadgeText: () => Promise.resolve(),
    setBadgeBackgroundColor: () => Promise.resolve(),
    openPopup: () => Promise.resolve()
  },
  tabs: {
    query: () => Promise.resolve([])
  },
  windows: {
    create: () => Promise.resolve({ id: 1 }),
    remove: () => Promise.resolve(),
    onRemoved: {
      addListener: () => {},
      removeListener: () => {}
    }
  }
};

/** Reset all storage areas and notify listeners */
export function resetMockStorage(): void {
  local._reset();
  sync._reset();
  session._reset();
  alarms._reset();
  // Fire onChanged with a wildcard marker so all in-memory caches are invalidated
  fireOnChanged({ signerPermissions: {}, signerUseGlobalDefaults: {}, allowedDomains: {}, weblnAllowedDomains: {}, dismissedDomains: {} }, 'local');
}

export default mock;
