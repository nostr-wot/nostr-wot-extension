import browser from '@lib/browser.ts';
import { freshProfileEntry, publicProfile } from '@domain/profile/publicProfile';
import type { ProfileMetadata } from '@domain/profile/profileMetadata';

/** The cached public profile while it is still fresh, else null. Reads storage only. */
export async function readFreshProfile(pubkey: string): Promise<ProfileMetadata | null> {
  const key = `profile_${pubkey}`;
  const stored = await browser.storage.local.get(key);
  return freshProfileEntry(stored[key]) ? publicProfile(stored[key].metadata) : null;
}
