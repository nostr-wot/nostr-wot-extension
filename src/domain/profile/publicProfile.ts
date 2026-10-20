import { PROFILE_CACHE_TTL_MS } from '@constants/profile';
import type { ProfileMetadata } from './profileMetadata';

/** Display-only fields; malformed relay values never reach rendering. */
export function publicProfile(value: unknown): ProfileMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).filter(([, field]) => typeof field === 'string'));
}
export function profileDisplayName(meta: ProfileMetadata | null, fallback = '—'): string {
  return [meta?.display_name, meta?.name].find((value): value is string => typeof value === 'string' && !!value.trim()) || fallback;
}
export function freshProfileEntry(value: unknown, now = Date.now()): value is {metadata: ProfileMetadata; fetchedAt: number} {
  if (!value || typeof value !== 'object') return false;
  const entry = value as {metadata?: unknown; fetchedAt?: unknown};
  return typeof entry.fetchedAt === 'number' && Number.isFinite(entry.fetchedAt) && entry.fetchedAt <= now && now - entry.fetchedAt < PROFILE_CACHE_TTL_MS && publicProfile(entry.metadata) !== null;
}

/** Reuse either public metadata cache without treating stale entries as freshly fetched. */
export function cachedPublicProfile(stored: Record<string, unknown>, pubkey: string): ProfileMetadata | null {
  const entry = stored[`profile_${pubkey}`];
  const shared = stored.profileCache;
  const metadata = entry && typeof entry === 'object' && 'metadata' in entry ? entry.metadata : undefined;
  const fallback = shared && typeof shared === 'object' ? (shared as Record<string, unknown>)[pubkey] : undefined;
  return publicProfile(metadata) || publicProfile(fallback);
}
