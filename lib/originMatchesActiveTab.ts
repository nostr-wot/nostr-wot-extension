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
