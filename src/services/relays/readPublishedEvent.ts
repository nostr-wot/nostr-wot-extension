import { liveQuery, writeLocalCache } from './relay.ts';
import { verifyEvent } from '../../lib/crypto/nip01.ts';
import type { SignedEvent } from '../../domain/nostr/types.ts';

/** Read all answering relays before choosing a replaceable event. A socket
 * closing without EOSE is not evidence that the author has never published. */
export async function readPublishedEvent(pubkey: string, kind: number, relays: string[]) {
  let event: SignedEvent | null = null;
  let reachable = false;
  for await (const item of liveQuery([{ kinds: [kind], authors: [pubkey], limit: 1 }], [...new Set(relays)], { closeOnExhaust: true })) {
    if (item.type === 'eose') reachable = true;
    if (item.type !== 'event' && item.type !== 'update') continue;
    const candidate = item.event;
    if (candidate.kind !== kind || candidate.pubkey !== pubkey || !await verifyEvent(candidate)) continue;
    if (item.type === 'update' || item.source === 'relay') reachable = true;
    if (!event || candidate.created_at > event.created_at) event = candidate;
  }
  // Retain signed evidence across relay outages and empty answers from other
  // relays. A later empty response does not revoke an existing publication.
  if (event) await writeLocalCache(event);
  return { pubkey, event, reachable };
}
