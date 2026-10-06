import * as kinds from 'nostr-tools/kinds';
import { ARCHIVE_COPY_KINDS } from '@constants/archive-policy.ts';
import type { SignedEvent } from '@domain/nostr/types.ts';

export function isPrivateMessage(event: SignedEvent): boolean {
  return [kinds.EncryptedDirectMessage, kinds.GiftWrap, kinds.PrivateDirectMessage, kinds.Seal].includes(
    event.kind,
  );
}
export function eventBelongs(event: SignedEvent, pubkey: string, includeMessages: boolean): boolean {
  if (isPrivateMessage(event))
    return (
      includeMessages &&
      [kinds.EncryptedDirectMessage, kinds.GiftWrap].includes(event.kind) &&
      (event.pubkey === pubkey || event.tags.some((t) => t[0] === 'p' && t[1] === pubkey))
    );
  return event.pubkey === pubkey;
}
export function shouldArchive(event: SignedEvent): boolean {
  return !kinds.isEphemeralKind(event.kind);
}
export function replacementKey(event: SignedEvent): string | undefined {
  if (kinds.isReplaceableKind(event.kind)) return `${event.kind}:${event.pubkey}:`;
  if (kinds.isAddressableKind(event.kind))
    return `${event.kind}:${event.pubkey}:${event.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`;
}
export function canCopyEvent(
  event: SignedEvent,
  includeMessages = false,
  includeUnknown = false,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (
    !shouldArchive(event) ||
    [kinds.Seal, kinds.PrivateDirectMessage].includes(event.kind) ||
    (!includeUnknown && !ARCHIVE_COPY_KINDS.has(event.kind)) ||
    (!includeMessages && isPrivateMessage(event))
  )
    return false;
  return !event.tags.some((t) => t[0] === 'expiration' && /^\d+$/.test(t[1] ?? '') && Number(t[1]) <= now);
}
