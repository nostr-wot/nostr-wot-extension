import { finalizeEvent, getPublicKey, verifyEvent, type Event } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';

/** The paired transport keys also address the standard NIP-46 event. */
export class LocalNip46Events {
  private readonly secret: Uint8Array;
  private readonly conversation: Uint8Array;
  private readonly peer: string;

  constructor(secret: Uint8Array, private readonly host: string) {
    this.secret = secret.slice();
    this.peer = getPublicKey(secret);
    this.conversation = nip44.utils.getConversationKey(secret, host);
  }

  encode(request: string): string {
    return JSON.stringify(finalizeEvent({
      kind: 24133,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', this.host]],
      content: nip44.encrypt(request, this.conversation),
    }, this.secret));
  }

  decode(payload: string): string {
    const event: Event = JSON.parse(payload);
    if (event?.kind !== 24133 || event.pubkey !== this.host || !verifyEvent(event))
      throw new Error('Invalid local NIP-46 response event');
    const recipients = event.tags.filter(tag => tag[0] === 'p');
    if (recipients.length !== 1 || recipients[0][1] !== this.peer)
      throw new Error('Wrong local NIP-46 response recipient');
    return nip44.decrypt(event.content, this.conversation);
  }

  close(): void {
    this.secret.fill(0);
    this.conversation.fill(0);
  }
}
