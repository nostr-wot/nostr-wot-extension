import browser from '@lib/browser.ts';
import { rpcRead } from '@services/rpc.ts';
import { freshProfileEntry } from '@domain/profile/publicProfile.ts';
import { npubDecode } from '@lib/crypto/bech32.ts';
import { anyProfileReachable, selectFollowSuggestions } from '@domain/wizard/followSuggestions.ts';

/**
 * One selection and one relay check per popup, shared by the steps that start
 * the lookup early and the step that shows its result.
 */
let selection: Array<{ npub: string; hex: string }> | null = null;
let reachable: Promise<boolean> | null = null;

export function followSuggestions(): Array<{ npub: string; hex: string }> {
  selection ??= selectFollowSuggestions().reduce<Array<{ npub: string; hex: string }>>((acc, npub) => {
    try {
      acc.push({ npub, hex: npubDecode(npub) });
    } catch { /* skip invalid npub */ }
    return acc;
  }, []);
  return selection;
}

/** The cached profile when fresh, as usePublicProfile reads it, else a relay lookup. */
async function lookupProfile(pubkey: string): Promise<unknown> {
  const key = `profile_${pubkey}`;
  const stored = await browser.storage.local.get(key);
  if (freshProfileEntry(stored[key])) return stored[key].metadata;
  return rpcRead('getProfileMetadata', { pubkey, directory: true });
}

/**
 * Start fetching the suggested profiles. The lookups fill the profile cache the
 * step renders from, so they appear at once; the result says whether any relay
 * answered. Safe to call repeatedly.
 */
export function preloadFollowSuggestions(): Promise<boolean> {
  reachable ??= anyProfileReachable(
    followSuggestions().map((s) => s.hex),
    lookupProfile,
  );
  return reachable;
}

/** Forget the selection and relay answer; for tests and a fresh wizard run. */
export function resetFollowSuggestionsPreload(): void {
  selection = null;
  reachable = null;
}
