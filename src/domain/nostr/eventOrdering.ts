import type { SignedEvent } from './types.ts';

/** NIP-01 replacement ordering, shared by transport and graph ingestion. */
export function isNewerReplaceable(
  candidate: Pick<SignedEvent, 'created_at' | 'id'>,
  current: Pick<SignedEvent, 'created_at' | 'id'>,
): boolean {
  return (
    candidate.created_at > current.created_at ||
    (candidate.created_at === current.created_at && candidate.id < current.id)
  );
}
