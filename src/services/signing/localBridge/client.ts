import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { getPublicKey } from 'nostr-tools/pure';
import { v2 as nip44 } from 'nostr-tools/nip44';
import { decode64, deriveKeys, encode64, equalMac, mac, MAX_FRAME_BYTES, transcript, utf8, type PairingOffer } from './protocol';
export interface BridgeTransport {
  open(): Promise<void>;
  send(frame: string): Promise<void>;
  close(): void;
  onMessage(handler: (frame: string) => void): () => void;
  onClose(handler: (error?: Error) => void): () => void;
}
type Pending = { id: string; resolve: (value: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export class LocalBridgeClient {
  private keys?: ReturnType<typeof deriveKeys>;
  private pending = new Map<number, Pending>();
  private seq = 0;
  private closed = false;
  private closeError?: Error;
  private closeListeners = new Set<(error: Error) => void>();
  private cleanup: (() => void)[] = [];
  private welcome?: (frame: Record<string, unknown>) => void;
  private confirmation?: (frame: Record<string, unknown>) => void;
  private handshakeReject?: (error: Error) => void;
  private constructor(
    private transport: BridgeTransport,
    private timeoutMs: number,
  ) {}
  static async connect(options: {
    offer: PairingOffer;
    secretKey: Uint8Array;
    transport: BridgeTransport;
    timeoutMs?: number;
    onConfirmation?: (code: string) => void;
  }): Promise<LocalBridgeClient> {
    const { offer, secretKey, transport } = options;
    const client = new LocalBridgeClient(transport, options.timeoutMs ?? 60000);
    const peer = getPublicKey(secretKey),
      nonce = encode64(randomBytes(16));
    const ids = [offer.hostPubkey, peer, nonce];
    client.cleanup.push(
      transport.onMessage((text) => client.receive(text)),
      transport.onClose((error) => client.fail(error ?? new Error('Local signer disconnected'))),
    );
    let confirmed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handshake = new Promise<void>((resolve, reject) => {
      client.handshakeReject = reject;
      timer = setTimeout(() => client.fail(new Error('Local signer connection timed out')), client.timeoutMs);
      client.confirmation = (frame) => {
        if (confirmed || frame.host !== offer.hostPubkey) throw new Error('Invalid pairing confirmation');
        decode64(frame.challenge, 16);
        const proof = transcript('confirm', ...ids, frame.challenge as string);
        const hash = sha256(utf8.encode(proof));
        if (!schnorr.verify(decode64(frame.sig, 64), hash, hexToBytes(offer.hostPubkey))) throw new Error('Invalid pairing confirmation signature');
        confirmed = true;
        options.onConfirmation?.((new DataView(hash.buffer, hash.byteOffset).getUint32(0) % 1_000_000).toString().padStart(6, '0'));
      };
      client.welcome = (frame) => {
        if (offer.psk && !confirmed) throw new Error('Update the phone app: pairing code confirmation is required');
        if (frame.host !== offer.hostPubkey || typeof frame.session !== 'string') throw new Error('Wrong local signer host');
        decode64(frame.session, 16);
        if (
          !schnorr.verify(
            decode64(frame.sig, 64),
            sha256(utf8.encode(transcript('welcome', ...ids, frame.session))),
            hexToBytes(offer.hostPubkey),
          )
        )
          throw new Error('Invalid local signer signature');
        const conv = nip44.utils.getConversationKey(secretKey, offer.hostPubkey);
        client.keys = deriveKeys(conv, transcript('session', ...ids, frame.session));
        conv.fill(0);
        client.welcome = undefined;
        client.confirmation = undefined;
        client.handshakeReject = undefined;
        resolve();
      };
    });
    // Register the rejection consumer before opening a potentially slow chooser/socket.
    void (async () => {
      await transport.open();
      if (client.closed) {
        transport.close();
        throw new Error('Local signer connection closed');
      }
      const ts = Math.floor(Date.now() / 1000),
        proof = transcript('hello', ...ids, ts);
      await transport.send(
        JSON.stringify({
          v: 2,
          t: 'hello',
          confirmation: 1,
          peer,
          nonce,
          ts,
          sig: encode64(schnorr.sign(sha256(utf8.encode(proof)), secretKey)),
          ...(offer.psk ? { mac: mac(decode64(offer.psk, 32), proof) } : {}),
          name: 'Nostr WoT Extension',
        }),
      );
    })().catch((error) => {
      client.fail(error instanceof Error ? error : new Error('Connection failed'));
    });
    try {
      await handshake;
      if (client.closed) throw new Error('Local signer connection closed');
      return client;
    } catch (error) {
      client.close();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  request(method: string, params: string[]): Promise<string> {
    if (this.closed || !this.keys) return Promise.reject(new Error('Local signer is not connected'));
    if (this.pending.size >= 32) return Promise.reject(new Error('Too many pending local signer requests'));
    const seq = ++this.seq,
      id = encode64(randomBytes(16));
    if (!Number.isSafeInteger(seq)) {
      this.close();
      return Promise.reject(new Error('Sequence exhausted'));
    }
    let frame: string;
    try {
      const payload = nip44.encrypt(JSON.stringify({ id, method, params }), this.keys.payload);
      frame = JSON.stringify({ v: 2, t: 'req', seq, payload, mac: mac(this.keys.mac, transcript('req', seq, payload)) });
      if (utf8.encode(frame).length > MAX_FRAME_BYTES) throw new Error('Local signer request too large');
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('Local signer request timed out; result unknown')), this.timeoutMs);
      this.pending.set(seq, { id, resolve, reject, timer });
      this.transport.send(frame).catch((error) => this.fail(error instanceof Error ? error : new Error('Local signer send failed')));
    });
  }
  private receive(text: string): void {
    if (this.closed) return;
    try {
      if (typeof text !== 'string' || utf8.encode(text).length > MAX_FRAME_BYTES) throw new Error('Invalid local signer frame');
      const frame = JSON.parse(text);
      if (!frame || frame.v !== 2) throw new Error('Unsupported local signer protocol version');
      if (frame.t === 'bye') throw new Error('Local signer closed the connection');
      if (this.welcome) {
        if (frame.t === 'confirm' && this.confirmation) { this.confirmation(frame); return; }
        if (frame.t !== 'welcome') throw new Error('Expected local signer welcome');
        this.welcome(frame);
        return;
      }
      if (!this.keys || frame.t !== 'res' || !Number.isSafeInteger(frame.seq) || frame.seq < 1 || typeof frame.payload !== 'string')
        throw new Error('Invalid local signer response');
      decode64(frame.mac, 32);
      if (!equalMac(mac(this.keys.mac, transcript('res', frame.seq, frame.payload)), frame.mac))
        throw new Error('Invalid local signer response MAC');
      const pending = this.pending.get(frame.seq);
      if (!pending) throw new Error('Uncorrelated local signer response');
      const response = JSON.parse(nip44.decrypt(frame.payload, this.keys.payload));
      if (!response || response.id !== pending.id || (typeof response.result !== 'string' && typeof response.error !== 'string'))
        throw new Error('Invalid local signer response payload');
      this.pending.delete(frame.seq);
      clearTimeout(pending.timer);
      if (typeof response.error === 'string') pending.reject(new Error(response.error || 'Local signer rejected request'));
      else pending.resolve(response.result);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error('Invalid local signer frame'));
    }
  }
  onClose(handler: (error: Error) => void): () => void {
    if (this.closeError) {
      handler(this.closeError);
      return () => {};
    }
    this.closeListeners.add(handler);
    return () => {
      this.closeListeners.delete(handler);
    };
  }
  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.closeError = error;
    this.handshakeReject?.(error);
    this.handshakeReject = undefined;
    this.welcome = undefined;
    this.confirmation = undefined;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    for (const remove of this.cleanup) remove();
    this.cleanup = [];
    this.keys?.mac.fill(0);
    this.keys?.payload.fill(0);
    this.keys = undefined;
    this.transport.close();
    for (const handler of this.closeListeners) {
      try {
        handler(error);
      } catch {
        /* Cleanup must continue for every subscriber. */
      }
    }
    this.closeListeners.clear();
  }
  close(): void {
    this.fail(new Error('Local signer connection closed'));
  }
}
