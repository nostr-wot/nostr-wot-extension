import { ARCHIVE_PAGE_SIZE, MAX_ARCHIVE_PAGE_SIZE } from '@constants/archive.ts';
import type { SignedEvent } from '@domain/nostr/types.ts';
import type { NostrFilter } from '@domain/relays/types.ts';
import type { ArchiveCheckpoint } from '@domain/archive/types.ts';

export interface ArchiveQueryResult {
  events: SignedEvent[];
  status: 'eose' | 'timeout' | 'closed' | 'error';
  message?: string;
  received: number;
}
export interface ArchivePageDependencies {
  query(filter: NostrFilter): Promise<ArchiveQueryResult>;
  commit(events: SignedEvent[], checkpoint: ArchiveCheckpoint): Promise<void>;
}
/** Inclusive boundaries prevent skipping events sharing a timestamp. Saturated seconds stay incomplete. */
export async function syncArchivePage(
  checkpoint: ArchiveCheckpoint,
  filter: NostrFilter,
  deps: ArchivePageDependencies,
  signal?: AbortSignal,
): Promise<ArchiveCheckpoint> {
  signal?.throwIfAborted();
  const until = checkpoint.nextUntil ?? checkpoint.until;
  let limit = ARCHIVE_PAGE_SIZE;
  while (true) {
    const page = await deps.query({ ...filter, since: checkpoint.since, until, limit });
    signal?.throwIfAborted();
    if (page.status !== 'eose') {
      // Valid events are useful even on interruption; coverage is unchanged.
      await deps.commit(page.events, { ...checkpoint, error: page.message || page.status });
      throw new Error(page.message || `Relay query ${page.status}`);
    }
    if (page.received >= limit && !page.events.length)
      throw new Error('Relay returned a saturated page without usable events');
    const oldest = page.events.reduce((min, event) => Math.min(min, event.created_at), until);
    if (page.received >= limit && oldest === until) {
      await deps.commit(page.events, checkpoint);
      if (limit >= MAX_ARCHIVE_PAGE_SIZE)
        throw new Error('Relay result limit reached within one second; history coverage is incomplete');
      limit *= 2;
      continue;
    }
    const complete = page.received < limit;
    const next: ArchiveCheckpoint = {
      ...checkpoint,
      nextUntil: complete ? undefined : oldest,
      complete,
      checkedAt: complete ? checkpoint.until * 1000 : checkpoint.checkedAt,
      fullCheckedAt: complete && checkpoint.since === 0 ? checkpoint.until * 1000 : checkpoint.fullCheckedAt,
      error: undefined,
    };
    await deps.commit(page.events, next);
    return next;
  }
}
