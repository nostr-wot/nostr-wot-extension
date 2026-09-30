import { DEFAULT_BUCKET, GLOBAL_RULES_SCOPE } from '@constants/permissions.ts';

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

/** Resolve globals and site overrides, accepting old layers during migration.
 * Consolidated storage contains only shared globals and account/site overrides.
 */
export function effectiveSitePermissions(
  stored: Record<string, Record<string, Record<string, string>>>, origin: string, accountId?: string | null,
): Record<string, string> {
  return {
    ...sitePermissionBucket(stored, GLOBAL_RULES_SCOPE, DEFAULT_BUCKET),
    ...(accountId ? sitePermissionBucket(stored, GLOBAL_RULES_SCOPE, accountId) : {}),
    ...sitePermissionBucket(stored, origin, DEFAULT_BUCKET),
    ...(accountId ? sitePermissionBucket(stored, origin, accountId) : {}),
  };
}
