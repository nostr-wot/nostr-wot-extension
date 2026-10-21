/**
 * Follow suggestions shown at the end of onboarding: which accounts, and
 * whether any relay can show them at all.
 *
 * The step used to discover relay trouble only once it was on screen, as a list
 * of blank profiles. Now the wizard starts the lookup a few steps earlier, and
 * when no profile comes back in time the step is skipped instead of shown.
 *
 * @module domain/wizard/followSuggestions
 */

import { TIER_1, TIER_2 } from '@constants/followSuggestions.ts';

/** How long the profile lookup may take before relays count as unreachable. */
export const FOLLOW_PRELOAD_TIMEOUT_MS = 8000;

/** How long publishing the follow list may take before onboarding moves on anyway. */
export const FOLLOW_PUBLISH_TIMEOUT_MS = 10000;

function shuffle<T>(arr: readonly T[], random: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Twelve distinct npubs: two from TIER_1 and ten from TIER_2, one TIER_1 per half. */
export function selectFollowSuggestions(random: () => number = Math.random): string[] {
  const shuffledT1 = shuffle(TIER_1, random);
  const shuffledT2 = shuffle(TIER_2, random);
  const used = new Set<string>();

  // First half: 1 TIER_1 + 4 TIER_2, shuffled
  const t1a = shuffledT1[0];
  used.add(t1a);
  const t2a = shuffledT2.filter((n) => !used.has(n)).slice(0, 4);
  t2a.forEach((n) => used.add(n));
  const firstHalf = shuffle([t1a, ...t2a], random);

  // Second half: 1 more TIER_1 + 6 TIER_2, shuffled (no repeats)
  const t1b = shuffledT1.find((n) => !used.has(n))!;
  used.add(t1b);
  const t2b = shuffledT2.filter((n) => !used.has(n)).slice(0, 6);
  const secondHalf = shuffle([t1b, ...t2b], random);

  return [...firstHalf, ...secondHalf];
}

/**
 * Resolve true as soon as any profile lookup returns metadata, false once all
 * of them came back empty or failed, or the deadline passed. A relay that is
 * merely slow therefore cannot hold onboarding beyond `timeoutMs`.
 */
export function anyProfileReachable(
  pubkeys: readonly string[],
  fetchProfile: (pubkey: string) => Promise<unknown>,
  timeoutMs: number = FOLLOW_PRELOAD_TIMEOUT_MS,
): Promise<boolean> {
  if (pubkeys.length === 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    let pending = pubkeys.length;
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const finish = (found: boolean) => {
      if (found) { clearTimeout(timer); resolve(true); return; }
      if (--pending === 0) { clearTimeout(timer); resolve(false); }
    };
    for (const pubkey of pubkeys) {
      fetchProfile(pubkey).then((profile) => finish(!!profile), () => finish(false));
    }
  });
}
