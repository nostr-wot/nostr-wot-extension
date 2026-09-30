import browser from '@lib/browser';
import { rpc } from '@services/rpc';
import useStorageWatch from '@hooks/useStorageWatch';
import useAsyncResource from '@hooks/useAsyncResource';
import { freshProfileEntry, publicProfile } from '@domain/profile/publicProfile';
import type { ProfileMetadata } from '@domain/profile/profileMetadata';

/** Public metadata only. Callers explicitly decide whether directory lookup is safe. */
export default function usePublicProfile(pubkey: string | null | undefined, { enabled = true, lookup = true } = {}) {
  const resource = useAsyncResource<{ profile: ProfileMetadata | null }>({ profile: null }, {
    deps: [pubkey, enabled, lookup],
    load: async (patch, current) => {
      patch({ profile: null });
      if (!enabled || !pubkey || !/^[a-f0-9]{64}$/i.test(pubkey)) return;
      const key = `profile_${pubkey}`;
      const stored = await browser.storage.local.get(key);
      if (!current()) return;
      if (freshProfileEntry(stored[key])) { patch({ profile: publicProfile(stored[key].metadata) }); return; }
      if (!lookup) return;
      const result = await rpc<unknown>('getProfileMetadata', { pubkey, directory: true });
      if (current()) patch({ profile: publicProfile(result) });
    },
  });
  useStorageWatch([{ area: 'local', keys: [`profile_${pubkey}`] }], () => { void resource.refresh(); });
  return { profile: resource.data.profile, loading: resource.loading };
}
