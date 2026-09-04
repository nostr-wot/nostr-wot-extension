import React, { useCallback, type ReactNode } from 'react';
import browser from '@shared/browser.ts';
import { rpcNotify } from '@shared/rpc.ts';
import { DEFAULT_RELAYS } from '@shared/constants.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import useStorageWatch from '@hooks/useStorageWatch.ts';
import createRequiredContext from './createRequiredContext.ts';

export interface RelayFlags {
  read: boolean;
  write: boolean;
}

interface RelaysData {
  relays: string[];
  relayFlags: Record<string, RelayFlags>;
  /** False until the first storage read resolves. Lets a one-time consumer
   *  effect (e.g. the initial health check) wait for real data instead of
   *  running against the empty starting array. */
  loaded: boolean;
}

interface RelaysContextValue extends RelaysData {
  reload: () => Promise<void>;
  /** Persists both the list and the read/write flags, then updates the
   *  in-memory copy immediately — writing to `storage.sync` and waiting for the
   *  `onChanged` echo to come back added a round trip the editable list did not
   *  have when it held this state itself. */
  saveRelays: (list: string[], flags: Record<string, RelayFlags>) => Promise<void>;
}

const [RelaysContext, useRelays] = createRequiredContext<RelaysContextValue>('useRelays');

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
  const { data, refresh: reload, patch } = useAsyncResource<RelaysData>(
    { relays: [], relayFlags: {}, loaded: false },
    {
      load: async (patch) => {
        const [syncData, localData] = await Promise.all([
          browser.storage.sync.get(['relays']) as Promise<Record<string, unknown>>,
          browser.storage.local.get(['relayFlags']) as Promise<Record<string, unknown>>,
        ]);
        const relayStr = (syncData.relays as string) || DEFAULT_RELAYS;
        patch({
          relays: relayStr.split(',').map((s) => s.trim()).filter(Boolean),
          relayFlags: (localData.relayFlags as Record<string, RelayFlags>) || {},
          loaded: true,
        });
      },
    },
  );
  const { relays, relayFlags, loaded } = data;

  // `relays` lives in `sync`, `relayFlags` in `local` — one listener, two
  // areas, both routed to the same `reload` (docs §9: a listener that only
  // checks one area silently misses writes to the other).
  useStorageWatch(
    [
      { area: 'sync', keys: ['relays'] },
      { area: 'local', keys: ['relayFlags'] },
    ],
    reload,
  );

  const saveRelays = useCallback(async (list: string[], flags: Record<string, RelayFlags>) => {
    patch({ relays: list, relayFlags: flags });
    await browser.storage.sync.set({ relays: list.join(',') });
    await browser.storage.local.set({ relayFlags: flags });
    rpcNotify('configUpdated');
  }, [patch]);

  const value: RelaysContextValue = { relays, relayFlags, loaded, reload, saveRelays };

  return <RelaysContext.Provider value={value}>{children}</RelaysContext.Provider>;
}

export { useRelays };
