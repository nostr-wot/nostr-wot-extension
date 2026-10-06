import type { SignedEvent } from '@domain/nostr/types.ts';
import type { NostrFilter } from './types.ts';
import { MAX_EVENT_TAGS, MAX_TAG_VALUES } from '@constants/signing.ts';

/** Validate every requested constraint locally, since relays may ignore filters. */
export function matchesRelayFilter(event: SignedEvent, filter: NostrFilter): boolean {
  if (
    !event ||
    typeof event.id !== 'string' ||
    typeof event.pubkey !== 'string' ||
    !Number.isSafeInteger(event.kind) ||
    event.kind < 0 ||
    !Number.isSafeInteger(event.created_at) ||
    event.created_at < 0 ||
    typeof event.content !== 'string' ||
    !Array.isArray(event.tags) ||
    event.tags.length > MAX_EVENT_TAGS ||
    event.tags.some(
      (tag) =>
        !Array.isArray(tag) || tag.length > MAX_TAG_VALUES || tag.some((value) => typeof value !== 'string'),
    )
  )
    return false;
  if (filter.ids && !filter.ids.some((id) => event.id.startsWith(id))) return false;
  if (filter.authors && !filter.authors.some((author) => event.pubkey.startsWith(author))) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;
  for (const [key, values] of Object.entries(filter)) {
    if (
      key.startsWith('#') &&
      Array.isArray(values) &&
      !event.tags.some((tag) => tag[0] === key.slice(1) && values.includes(tag[1]))
    )
      return false;
  }
  return true;
}
