/**
 * Pure decision for whether to inject WoT trust badges into a page.
 *
 * Badges are an EXPERIMENTAL, opt-in feature: they inject only when the user has
 * explicitly enabled them (`wotInjectionEnabled === true`). An unset/undefined
 * value means OFF by default. A per-domain entry in `badgeDisabledSites` can
 * additionally suppress badges on that specific site.
 */
export function shouldInjectBadges(
  wotInjectionEnabled: unknown,
  badgeDisabledSites: Set<string>,
  domain: string | null,
): boolean {
  if (wotInjectionEnabled !== true) return false; // off by default — must opt in
  return !domain || !badgeDisabledSites.has(domain);
}
