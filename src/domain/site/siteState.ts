import { hasSiteScope, siteScopes } from './siteScope.ts';
/**
 * Pure decision helper for a site's connection status.
 *
 * Both Home (the popup home view) and GlobeButton (the top-bar connection dot) derive
 * "is this site connected?" from the `allowedDomains` storage allowlist — NOT from
 * `browser.permissions.contains()`. The two can diverge: a granted `<all_urls>` makes
 * `permissions.contains` true for every site, which would make the dot read "connected"
 * everywhere. The allowlist is the single source of truth, and after the connect rewiring
 * it has exactly one writer: the `connectDomain` RPC behind the Connect card.
 *
 * Signer permissions deliberately play no part. They used to: a site with any stored
 * permission counted as connected and was auto-added back to the allowlist, which meant
 * Disconnect did not stick (it never cleared those permissions) and — because the check
 * counted any entry, including an explicit `deny` — a site the user had refused could be
 * auto-connected. Permissions record what a connected site may do; they are not evidence
 * that it is connected.
 *
 * @module domain/site/siteState
 */

export type SiteConnectionState = 'connected' | 'notConnected' | 'error';

/**
 * Decide a site's connection state.
 *
 * This used to take the signer permissions too, ignore them (`void signerPerms`),
 * and carry a comment saying they were kept "because callers already load it for
 * other purposes". That was not true: the only caller fetched them for this call
 * and nothing else, so every popup open paid for a round trip whose result was
 * discarded on the next line. The parameter is gone and so is the fetch.
 *
 * @param allowedDomains Allowlist from `getAllowedDomains`, or null if that RPC failed.
 * @param domain The hostname being evaluated.
 */
export function resolveSiteState(
  allowedDomains: string[] | null,
  domain: string,
): SiteConnectionState {
  // A failed read is not a "no" and must not be reported as one: answering 'notConnected'
  // would show the Connect card to an already-connected site, and answering 'connected'
  // would be worse.
  if (allowedDomains === null) return 'error';
  return hasSiteScope(allowedDomains, domain) ? 'connected' : 'notConnected';
}

/** A stored "Not now" / "Never" for one site scope, as `addDismissedDomain` writes it. */
export interface StoredDismissal {
  until?: number | 'session' | 'never';
}

/**
 * Whether the user has declined this site, by the same rule as the background's
 * `isDomainDismissed`, read from storage so the popup does not wait on the worker.
 * Session dismissals live in `storage.session`; timed ones count until they expire.
 */
export function isSiteDismissed(
  dismissals: Record<string, StoredDismissal> | string[] | null | undefined,
  sessionDismissed: string[] | null | undefined,
  domain: string,
  now = Date.now(),
): boolean {
  if (hasSiteScope(sessionDismissed || [], domain)) return true;
  if (!dismissals) return false;
  // The legacy list carries no dates; the background migrates it to a fresh timed entry.
  if (Array.isArray(dismissals)) return hasSiteScope(dismissals, domain);
  return siteScopes(domain).some((scope) => {
    const until = dismissals[scope]?.until;
    return until === 'never' || (typeof until === 'number' && until > now);
  });
}
