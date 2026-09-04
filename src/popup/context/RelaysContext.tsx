import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import browser from '@shared/browser.ts';
import { rpcNotify } from '@shared/rpc.ts';
import { DEFAULT_RELAYS } from '@shared/constants.ts';

export interface RelayFlags {
  read: boolean;
  write: boolean;
}

interface RelaysContextValue {
  relays: string[];
  relayFlags: Record<string, RelayFlags>;
  /** False until the first storage read resolves. Lets a one-time consumer
   *  effect (e.g. the initial health check) wait for real data instead of
   *  running against the empty starting array. */
  loaded: boolean;
  reload: () => Promise<void>;
  /** Persists both the list and the read/write flags, then updates the
   *  in-memory copy immediately — writing to `storage.sync` and waiting for the
   *  `onChanged` echo to come back added a round trip the editable list did not
   *  have when it held this state itself. */
  saveRelays: (list: string[], flags: Record<string, RelayFlags>) => Promise<void>;
}

const RelaysContext = createContext<RelaysContextValue | null>(null);

interface RelaysProviderProps {
  children: ReactNode;
}

/**
 * The user's NIP-65 relay list, read once here instead of by every surface
 * that shows it.
 *
 * `RelaysRow` (the home-screen summary) and `NetworkSection` (the editor) each
 * used to hand-roll their own `storage.sync.get(['relays'])` plus an
 * `onChanged` listener. `relays` lives in the **sync** area, unlike almost
 * everything else the popup listens for — a listener that only checks `local`
 * never sees an edit (docs/component-standards.md §9).
 */
export function RelaysProvider({ children }: RelaysProviderProps) {
  const [relays, setRelays] = useState<string[]>([]);
  const [relayFlags, setRelayFlags] = useState<Record<string, RelayFlags>>({});
  const [loaded, setLoaded] = useState<boolean>(false);

  const reload = useCallback(async () => {
    const [syncData, localData] = await Promise.all([
      browser.storage.sync.get(['relays']) as Promise<Record<string, unknown>>,
      browser.storage.local.get(['relayFlags']) as Promise<Record<string, unknown>>,
    ]);
    const relayStr = (syncData.relays as string) || DEFAULT_RELAYS;
    setRelays(relayStr.split(',').map((s) => s.trim()).filter(Boolean));
    setRelayFlags((localData.relayFlags as Record<string, RelayFlags>) || {});
    setLoaded(true);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    function onChange(changes: Record<string, { newValue?: unknown }>, area: string) {
      if (area === 'sync' && changes.relays) reload();
      else if (area === 'local' && changes.relayFlags) reload();
    }
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [reload]);

  const saveRelays = useCallback(async (list: string[], flags: Record<string, RelayFlags>) => {
    setRelays(list);
    setRelayFlags(flags);
    await browser.storage.sync.set({ relays: list.join(',') });
    await browser.storage.local.set({ relayFlags: flags });
    rpcNotify('configUpdated');
  }, []);

  const value: RelaysContextValue = { relays, relayFlags, loaded, reload, saveRelays };

  return <RelaysContext.Provider value={value}>{children}</RelaysContext.Provider>;
}

export function useRelays(): RelaysContextValue {
  const ctx = useContext(RelaysContext);
  if (!ctx) throw new Error('useRelays must be used within RelaysProvider');
  return ctx;
}
