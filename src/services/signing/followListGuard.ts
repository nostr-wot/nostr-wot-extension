import browser from '@lib/browser.ts';
import type { UnsignedEvent, SignedEvent } from '@domain/nostr/types.ts';
import { DEFAULT_RELAYS } from '@constants/relays.ts';
import { SIGNED_FOLLOW_LIST_PREFIX } from '@constants/signing.ts';
import { readLocalCache, isNewerReplaceable } from '@services/relays/relay.ts';
import { readPublishedEvent } from '@services/relays/readPublishedEvent.ts';
import { AsyncLock } from '@utils/asyncLock.ts';
import { verifyEvent } from '@lib/crypto/nip01.ts';

import { readPublicLists } from '@services/wot/public-lists.ts';

const historyLock = new AsyncLock();

export function followCount(event: Pick<UnsignedEvent, 'tags'>): number {
  return new Set(event.tags.filter(tag => tag[0] === 'p' && /^[0-9a-f]{64}$/i.test(tag[1] || '')).map(tag => tag[1].toLowerCase())).size;
}

/** Signed locally is useful evidence, but must never masquerade as published. */
export async function rememberSignedFollowList(event: SignedEvent): Promise<void> {
  if (event.kind !== 3 || !await verifyEvent(event)) return;
  await historyLock.run(async () => {
    const key = SIGNED_FOLLOW_LIST_PREFIX + event.pubkey;
    const previous = (await browser.storage.local.get(key))[key] as SignedEvent | undefined;
    if (previous?.kind === 3 && previous.pubkey === event.pubkey && await verifyEvent(previous) && !isNewerReplaceable(event, previous)) return;
    await browser.storage.local.set({ [key]: event });
  });
}

/** Only empty or singleton replacements need this lookup; ordinary signing stays local. */
export async function followReplacementCount(event: UnsignedEvent, pubkey: string): Promise<number | undefined> {
  if (event.kind !== 3) return;
  const proposedCount = followCount(event);
  if (proposedCount > 1) return;
  const key = SIGNED_FOLLOW_LIST_PREFIX + pubkey;
  const stored = (await browser.storage.local.get(key))[key] as SignedEvent | undefined;
  let previous = stored?.kind === 3 && stored.pubkey === pubkey && await verifyEvent(stored) ? stored : undefined;
  for (const candidate of await readLocalCache([{ kinds: [3], authors: [pubkey] }])) {
    if (candidate.kind === 3 && candidate.pubkey === pubkey && (!previous || isNewerReplaceable(candidate, previous))) previous = candidate;
  }
  // WoT sync stores verified public lists in IndexedDB, not the relay cache.
  // Use only this author's versioned record and respect newer signed changes.
  const synced = await readPublicLists(pubkey).catch(() => undefined);
  let known = previous ? { created_at: previous.created_at, id: previous.id, count: followCount(previous) } : undefined;
  if (synced?.pubkey === pubkey && synced.followVersion && synced.follows) {
    const candidate = { created_at: synced.followVersion.createdAt, id: synced.followVersion.id,
      count: followCount({ tags: synced.follows.map(key => ['p', key]) }) };
    if (!known || isNewerReplaceable(candidate, known)) known = candidate;
  }
  // Known evidence of a dangerous reduction is enough to ask immediately.
  if (known && known.count > proposedCount) return known.count;
  const { relays } = await browser.storage.sync.get('relays');
  const configured = typeof relays === 'string' ? relays.split(',').map(url => url.trim()).filter(Boolean) : [];
  const published = await readPublishedEvent(pubkey, 3, configured.length ? configured : DEFAULT_RELAYS);
  if (published.event && (!known || isNewerReplaceable(published.event, known))) {
    known = { created_at: published.event.created_at, id: published.event.id, count: followCount(published.event) };
  }
  const count = known?.count || 0;
  return count > proposedCount ? count : undefined;
}
