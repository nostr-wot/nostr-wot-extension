import browser from '@lib/browser';
import { rpc } from '@services/rpc';
import useStorageWatch from '@hooks/useStorageWatch';
import useAsyncResource from '@hooks/useAsyncResource';
import { publicProfile, cachedPublicProfile } from '@domain/profile/publicProfile';
import { readFreshProfile } from '@services/profile/freshProfile';
import type { ProfileMetadata } from '@domain/profile/profileMetadata';

/** Public metadata only. Callers explicitly decide whether directory lookup is safe. */
export default function usePublicProfile(pubkey: string | null | undefined, { enabled = true, lookup = true, allowStale = false } = {}) {
  const resource = useAsyncResource<{ profile: ProfileMetadata | null }>({ profile: null }, {
    deps: [pubkey, enabled, lookup, allowStale],
    load: async (patch, current) => {
      patch({ profile: null });
      if (!enabled || !pubkey || !/^[a-f0-9]{64}$/i.test(pubkey)) return;
      const fresh = await readFreshProfile(pubkey);
      if (!current()) return;
      if (fresh) { patch({ profile: fresh }); return; }
      if (allowStale) {
        const stored = await browser.storage.local.get([`profile_${pubkey}`, 'profileCache']);
        if (!current()) return;
        const cached = cachedPublicProfile(stored, pubkey);
        if (cached) { patch({ profile: cached }); if (!lookup) return; }
      }
      if (!lookup) return;
      const result = await rpc<unknown>('getProfileMetadata', { pubkey, directory: true });
      if (current()) patch({ profile: publicProfile(result) });
    },
  });
  useStorageWatch([{ area: 'local', keys: [`profile_${pubkey}`, ...(allowStale ? ['profileCache'] : [])] }], () => { void resource.refresh(); });
  return { profile: resource.data.profile, loading: resource.loading };
}
