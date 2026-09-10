/** Read an exact origin plus its original hostname scope. Never creates a grant. */
export function siteScopes(origin: string): string[] {
  try {
    const url = new URL(origin);
    if (['http:', 'https:'].includes(url.protocol) && url.origin === origin) return [origin, url.hostname];
  } catch { /* Legacy/internal labels are already their own scope. */ }
  return [origin];
}

/** Existing hostname entries retain their historical scope; new origins stay exact. */
export function hasSiteScope(stored: readonly string[], origin: string): boolean {
  return siteScopes(origin).some(scope => stored.includes(scope));
}

/** Exact-origin edits override the same legacy key; unrelated legacy rules remain. */
export function sitePermissionBucket(
  stored: Record<string, Record<string, Record<string, string>>>, origin: string, bucket: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const scope of siteScopes(origin).reverse()) {
    for (const [key, value] of Object.entries(stored[scope]?.[bucket] || {})) {
      result[key] = value;
    }
  }
  return result;
}
