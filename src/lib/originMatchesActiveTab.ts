/**
 * Pure predicate (no browser dependency): should the action popup open for a
 * request from `origin` (a hostname), given the URL of the tab the user is
 * currently looking at?
 *
 * Only true when the active tab's hostname exactly matches the origin. This is
 * what keeps a background/inactive tab making nostr requests — or one polling
 * repeatedly — from popping the popup open in the user's face.
 */
export function originMatchesActiveTab(activeTabUrl: string | undefined | null, origin: string): boolean {
  if (!activeTabUrl || !origin) return false;
  try {
    return new URL(activeTabUrl).hostname === origin;
  } catch {
    return false;
  }
}

/** The subset of a browser tab this decision needs. */
export interface ActiveTabInfo {
  id?: number;
  url?: string;
}

/**
 * Should the popup open for this request — i.e. did it come from the tab the user is
 * looking at?
 *
 * Prefer the tab id when the caller knows which tab asked. `tabs.query()` strips `url`
 * (and title/favIconUrl) unless the extension holds the "tabs" permission or an explicit
 * host permission for that tab; content-script `matches` do not count — they are
 * scriptable hosts, which is what Chrome's "On all sites" display reflects, and they
 * grant nothing to the tabs API. So on a site the user has not connected yet the active
 * tab arrives with `url: undefined`, the hostname comparison fails closed, and the
 * connect popup never opens — the site's first `window.nostr` call produced silence.
 *
 * The tab id is never stripped, and it is the better signal anyway: it identifies the
 * tab that actually asked rather than merely a tab sharing its hostname. The hostname
 * comparison remains as the fallback for callers that have no tab id.
 *
 * @param activeTab - the tab the user is looking at, as returned by tabs.query
 * @param origin - hostname the request came from
 * @param requestingTabId - id of the tab that made the request, when known
 */
export function requestIsFromActiveTab(
  activeTab: ActiveTabInfo | undefined | null,
  origin: string,
  requestingTabId?: number,
): boolean {
  if (!activeTab) return false;
  if (typeof requestingTabId === 'number' && typeof activeTab.id === 'number') {
    return activeTab.id === requestingTabId;
  }
  return originMatchesActiveTab(activeTab.url, origin);
}
