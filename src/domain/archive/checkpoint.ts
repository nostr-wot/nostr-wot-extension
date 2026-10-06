import { ARCHIVE_OVERLAP_SECONDS, ARCHIVE_RECONCILE_MS } from '@constants/archive.ts';
import type { ArchiveCheckpoint } from './types.ts';

/** A run's upper boundary is fixed; arrivals during it belong to the next run. */
export function nextArchiveRange(
  previous: ArchiveCheckpoint | undefined,
  relay: string,
  stream: ArchiveCheckpoint['stream'],
  now: number,
  full = false,
): ArchiveCheckpoint {
  if (previous && !previous.complete && !full) return { ...previous, error: undefined };
  const reconcile = full || !previous?.fullCheckedAt || now - previous.fullCheckedAt >= ARCHIVE_RECONCILE_MS;
  return {
    key: `${relay}|${stream}`,
    relay,
    stream,
    since: reconcile ? 0 : Math.max(0, Math.floor(previous!.checkedAt / 1000) - ARCHIVE_OVERLAP_SECONDS),
    until: Math.floor(now / 1000),
    complete: false,
    checkedAt: previous?.checkedAt ?? 0,
    fullCheckedAt: previous?.fullCheckedAt,
  };
}
