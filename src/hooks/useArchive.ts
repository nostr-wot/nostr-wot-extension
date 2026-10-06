import { ARCHIVE_PROGRESS_POLL_MS, ARCHIVE_CHANGED_KEY } from '@constants/archive.ts';
import { useEffect } from 'react';
import { LOCK_STATE_KEY } from '@constants/vault.ts';
import { rpc } from '@services/rpc.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import useStorageWatch from '@hooks/useStorageWatch.ts';
import { type ArchiveState } from '@domain/archive/types.ts';

export default function useArchive(accountId: string) {
  const resource = useAsyncResource<{ state: ArchiveState | null }>({ state: null }, {
    enabled: !!accountId, deps: [accountId],
    load: async (patch, current) => {
      const state = await rpc<ArchiveState>('archive_getState', { accountId });
      if (current()) patch({ state });
    },
  });
  const { refresh } = resource;
  useStorageWatch([{ area: 'local', keys: [ARCHIVE_CHANGED_KEY, LOCK_STATE_KEY] }], refresh);
  const state = resource.data.state?.accountId === accountId ? resource.data.state : null;
  const running = state?.progress.phase === 'syncing' || state?.progress.phase === 'copying';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), ARCHIVE_PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);
  return { ...resource, state, running };
}
