import { rpcRead } from '@services/rpc.ts';
import { readFreshProfile } from '@services/profile/freshProfile';
import { npubDecode } from '@lib/crypto/bech32.ts';
import { anyProfileReachable, selectFollowSuggestions } from '@domain/wizard/followSuggestions.ts';

/**
 * One selection per popup, and one relay check shared by the steps that start
 * the lookup early and the step that shows its result. Only a positive answer
 * is kept: a relay blip while the person is still on Create must not skip the
 * follow step minutes later, so after a failure the next call checks again.
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

/**
 * Start fetching the suggested profiles. The lookups fill the profile cache the
 * step renders from, so they appear at once; the result says whether any relay
 * answered. Safe to call repeatedly.
 */
export function preloadFollowSuggestions(): Promise<boolean> {
  if (!reachable) {
    const check = anyProfileReachable(
      followSuggestions().map((s) => s.hex),
      // Fresh cached profiles count without asking the background at all.
      async (pubkey) => (await readFreshProfile(pubkey)) ?? rpcRead('getProfileMetadata', { pubkey, directory: true }),
    );
    reachable = check;
    void check.then((ok) => { if (!ok && reachable === check) reachable = null; });
  }
  return reachable;
}

/** Forget the selection and relay answer between tests. */
export function resetFollowSuggestionsPreload(): void {
  selection = null;
  reachable = null;
}
