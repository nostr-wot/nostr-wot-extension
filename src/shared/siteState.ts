/**
 * Pure decision helper for a site's connection status.
 *
 * Both HomeTab (the popup home view) and GlobeButton (the top-bar connection
 * dot) derive "is this site connected?" from the `allowedDomains` storage
 * allowlist — NOT from `browser.permissions.contains()`. The two sources can
 * diverge: granting `<all_urls>` makes `permissions.contains` return true for
 * every site, which would make the dot read "connected" everywhere. The
 * allowlist is the single source of truth.
 *
 * @module shared/siteState
 */

export type SiteConnectionState = 'connected' | 'notConnected' | 'error';

/**
 * Decide a site's connection state from the allowlist and signer permissions.
 *
 * Mirrors the inline logic previously in HomeTab.loadHomeState:
 *  - Both inputs failed to load (null) -> 'error'
 *  - Domain is in the allowlist, OR the domain already has signer
 *    permissions -> 'connected'
 *  - Otherwise -> 'notConnected'
 *
 * @param allowedDomains Allowlist from `getAllowedDomains` RPC, or null if that
 *   RPC failed.
 * @param signerPerms Permission map from `signer_getPermissionsForDomain`, or
 *   null if that RPC failed. A non-empty map means the site has signer perms.
 * @param domain The hostname being evaluated.
 */
export function resolveSiteState(
  allowedDomains: string[] | null,
  signerPerms: Record<string, unknown> | null,
  domain: string,
): SiteConnectionState {
  if (allowedDomains === null && signerPerms === null) {
    return 'error';
  }
  const inAllowlist = (allowedDomains || []).includes(domain);
  const hasSignerPerms = Object.keys(signerPerms || {}).length > 0;
  return inAllowlist || hasSignerPerms ? 'connected' : 'notConnected';
}

/**
 * Whether the site has signer permissions but is not yet in the allowlist.
 * When true, callers should add the domain to the allowlist so the two sources
 * converge (auto-add-on-perms behavior).
 */
export function shouldAutoAddDomain(
  allowedDomains: string[] | null,
  signerPerms: Record<string, unknown> | null,
  domain: string,
): boolean {
  const inAllowlist = (allowedDomains || []).includes(domain);
  const hasSignerPerms = Object.keys(signerPerms || {}).length > 0;
  return hasSignerPerms && !inAllowlist;
}
