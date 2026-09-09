// ── Cache ──

/** Profile metadata cache TTL (30 minutes) */
export const PROFILE_CACHE_TTL_MS = 30 * 60 * 1000;

export const PROFILE_RETRY_MS = 60_000;

/** Fields the form owns, in the order they are applied. */
export const PROFILE_OWNED_FIELDS = ['name', 'about', 'picture', 'nip05', 'lud16', 'website', 'banner'] as const;
