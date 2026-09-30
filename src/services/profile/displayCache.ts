import browser from '@lib/browser';
import { PROFILE_CACHE_MAX_ENTRIES } from '@constants/profile';
import { freshProfileEntry } from '@domain/profile/publicProfile';
import { profileCache, type ProfileCacheEntry } from '../background/state';

const INDEX_KEY = 'publicProfileIndexV1';
const PROFILE_KEY = /^profile_[a-f0-9]{64}$/i;
let maintenance: Promise<void> = Promise.resolve();

// Storage remains authoritative across other extension contexts and vault reset.
// Invalidate positives immediately; a subsequent lookup reads only its own key.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!Object.keys(changes).length || (INDEX_KEY in changes && !changes[INDEX_KEY].newValue)) profileCache.clear();
  for (const key of Object.keys(changes)) {
    if (PROFILE_KEY.test(key)) profileCache.delete(key.slice(8));
  }
});

/** Serialized bounded-index maintenance. Only the legacy migration scans storage. */
export function maintainProfileCache(pubkey?: string, entry?: ProfileCacheEntry): Promise<void> {
  const run = maintenance.catch(() => {}).then(async () => {
    const storedIndex = (await browser.storage.local.get(INDEX_KEY))[INDEX_KEY];
    let index: Record<string, number> = {};
    let changed = false;
    const migrated = new Map<string, ProfileCacheEntry>();
    if (storedIndex && typeof storedIndex === 'object' && !Array.isArray(storedIndex)) {
      index = { ...storedIndex as Record<string, number> };
    } else {
      // One-time migration for installations predating the index (also after reset).
      const legacy = await browser.storage.local.get(null);
      for (const [key, value] of Object.entries(legacy)) {
        if (!PROFILE_KEY.test(key)) continue;
        index[key] = freshProfileEntry(value) ? value.fetchedAt : NaN;
        if (freshProfileEntry(value)) migrated.set(key.slice(8), value);
      }
      changed = true;
    }
    if (pubkey && entry) {
      if (!/^[a-f0-9]{64}$/i.test(pubkey)) throw new Error('Invalid profile public key');
      await browser.storage.local.set({ [`profile_${pubkey}`]: entry });
      index[`profile_${pubkey}`] = entry.fetchedAt;
      changed = true;
    }
    const now = Date.now();
    const ordered = Object.entries(index).filter(([key, fetchedAt]) =>
      PROFILE_KEY.test(key) && freshProfileEntry({ metadata: {}, fetchedAt }, now)
    ).sort((a, b) => b[1] - a[1]);
    const keep = new Set(ordered.slice(0, PROFILE_CACHE_MAX_ENTRIES).map(([key]) => key));
    const remove = Object.keys(index).filter(key => !keep.has(key));
    if (remove.length) {
      await browser.storage.local.remove(remove.filter(key => PROFILE_KEY.test(key)));
      for (const key of remove) delete index[key];
      changed = true;
    }
    if (changed) await browser.storage.local.set({ [INDEX_KEY]: index });
    for (const [key, value] of migrated) if (keep.has(`profile_${key}`)) profileCache.set(key, value);
    for (const [key, value] of profileCache) if (!keep.has(`profile_${key}`) || !freshProfileEntry(value, now)) profileCache.delete(key);
    if (pubkey && entry && keep.has(`profile_${pubkey}`) && freshProfileEntry(entry, now)) profileCache.set(pubkey, entry);
  });
  maintenance = run;
  return run;
}

/** A targeted read also observes deletion/reset even before onChanged is delivered. */
export async function readProfileCache(pubkey: string): Promise<ProfileCacheEntry | null> {
  await maintainProfileCache();
  const key = `profile_${pubkey}`;
  const entry = (await browser.storage.local.get(key))[key];
  if (!freshProfileEntry(entry)) { profileCache.delete(pubkey); return null; }
  profileCache.set(pubkey, entry);
  return entry;
}
