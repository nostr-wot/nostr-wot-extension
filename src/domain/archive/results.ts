import type { ArchiveCheckpoint, ArchiveRelayResult } from './types.ts';

/** A relay succeeds only when every requested stream completed; repeated errors are shown once. */
export function archiveRelayResults(
  relays: string[],
  includeMessages: boolean,
  checkpoints: ArchiveCheckpoint[],
): ArchiveRelayResult[] {
  const streams = includeMessages ? ['authored', 'messages', 'legacyMessages'] : ['authored'];
  return [...new Set(relays)].map((relay) => {
    const selected = checkpoints.filter((cp) => cp.relay === relay && streams.includes(cp.stream));
    const errors = [...new Set(selected.flatMap((cp) => (cp.error ? [cp.error] : [])))];
    return {
      relay,
      attempted: selected.length > 0,
      errors,
      success:
        errors.length === 0 &&
        streams.every((stream) => selected.some((cp) => cp.stream === stream && cp.complete)),
    };
  });
}

export function archiveResultStatus(results: ArchiveRelayResult[]): 'complete' | 'incomplete' | 'error' | 'notSynced' {
  if (!results.length || results.every(result => result.attempted === false)) return 'notSynced';
  if (results.every(result => result.success)) return 'complete';
  if (results.some(result => result.errors.length) && !results.some(result => result.success || (result.fetched ?? result.added ?? 0) > 0)) return 'error';
  return 'incomplete';
}
