import type { SignedEvent, UnsignedEvent } from '@domain/nostr/types.ts';
import { verifyEvent } from '@lib/crypto/nip01.ts';

/** Keep an unshared approval snapshot before any connection/signing await. */
export async function signVerifiedRemoteEvent(
  event: UnsignedEvent,
  expectedPubkey: string,
  sign: (event: UnsignedEvent) => Promise<SignedEvent>,
): Promise<SignedEvent> {
  const approved = structuredClone(event);
  approved.tags ??= [];
  approved.created_at ??= Math.floor(Date.now()/1000);
  if (approved.pubkey && approved.pubkey !== expectedPubkey) throw new Error('Unexpected remote event author');
  approved.pubkey = expectedPubkey;
  // The remote implementation may mutate its input. It never sees our snapshot.
  const result = structuredClone(await sign(structuredClone(approved)));
  if (!result || result.pubkey !== expectedPubkey) throw new Error('Unexpected remote event author');
  if (result.kind !== approved.kind || result.created_at !== approved.created_at
    || result.content !== approved.content || JSON.stringify(result.tags) !== JSON.stringify(approved.tags)) {
    throw new Error('Remote signer changed the approved event');
  }
  if (!(await verifyEvent(result))) throw new Error('Invalid remote event signature');
  // Return only signed canonical fields, never unverified remote extensions.
  return {pubkey:result.pubkey,created_at:result.created_at,kind:result.kind,tags:result.tags,content:result.content,id:result.id,sig:result.sig};
}
