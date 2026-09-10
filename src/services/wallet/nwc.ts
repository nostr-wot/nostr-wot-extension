import { NWC_REQUEST_TIMEOUT_MS } from '@constants/wallet.ts';
/**
 * NWC (Nostr Wallet Connect, NIP-47) wallet provider
 *
 * Communicates with a Lightning wallet via encrypted Nostr events over a relay.
 * Kind 23194 = NWC request, Kind 23195 = NWC response.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/47.md — NIP-47
 *
 * @module services/wallet/nwc
 */

import type { UnsignedEvent, SignedEvent } from '../../domain/nostr/types.ts';
import type { WalletProvider, WalletProviderInfo, Transaction } from '../../domain/wallet/types.ts';
import { hexToBytes, bytesToHex } from '../../lib/crypto/utils.ts';
import { verifyEvent as verifyEventNip01 } from '../../lib/crypto/nip01.ts';

// ── Parsed URI ──

export interface NwcParsedUri {
  walletPubkey: string;
  relay: string;
  secret: string;
}

// ── Crypto dependency injection ──

export interface NwcCryptoDeps {
  encrypt(plaintext: string, privkey: Uint8Array, theirPubkey: Uint8Array): Promise<string>;
  decrypt(ciphertext: string, privkey: Uint8Array, theirPubkey: Uint8Array): Promise<string>;
  getPubkey(privkey: Uint8Array): Uint8Array;
  signEvent(event: UnsignedEvent, privkey: Uint8Array): Promise<SignedEvent>;
  /** Optional override for tests — defaults to the real NIP-01 verifyEvent. */
  verifyEvent?(event: SignedEvent): Promise<boolean>;
}

// ── NWC config ──

export interface NwcConfig {
  connectionString: string;
}

// ── Pending request tracking ──

interface PendingNwcRequest {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── NWC response content shape ──

interface NwcResponseContent {
  result_type: string;
  error?: { code: string; message: string };
  result?: Record<string, unknown>;
}

// ── Provider ──

export class NwcProvider implements WalletProvider {
  readonly type = 'nwc' as const;

  private readonly walletPubkey: string;
  private readonly relay: string;
  private secret: Uint8Array;
  private readonly deps: NwcCryptoDeps;

  private ws: WebSocket | null = null;
  private _connected = false;
  private disposed = false;
  private connecting: Promise<void> | null = null;
  private readonly cancellations = new Set<(error: Error) => void>();
  private readonly pending = new Map<string, PendingNwcRequest>();

  constructor(config: NwcConfig, secret: Uint8Array, deps: NwcCryptoDeps) {
    const parsed = NwcProvider.parseConnectionString(config.connectionString);
    this.walletPubkey = parsed.walletPubkey;
    this.relay = parsed.relay;
    this.secret = secret;
    this.deps = deps;
  }

  // ── Static helpers (testable without instantiation) ──

  static parseConnectionString(uri: string): NwcParsedUri {
    if (!uri.startsWith('nostr+walletconnect://')) {
      throw new Error('Invalid NWC URI: must start with nostr+walletconnect://');
    }

    const withoutScheme = uri.slice('nostr+walletconnect://'.length);
    const qIndex = withoutScheme.indexOf('?');
    if (qIndex === -1) {
      throw new Error('Invalid NWC URI: missing query parameters');
    }

    const walletPubkey = withoutScheme.slice(0, qIndex);
    const params = new URLSearchParams(withoutScheme.slice(qIndex + 1));

    const relay = params.get('relay');
    if (!relay) {
      throw new Error('Invalid NWC URI: missing relay parameter');
    }

    const secret = params.get('secret');
    if (!secret) {
      throw new Error('Invalid NWC URI: missing secret parameter');
    }

    return { walletPubkey, relay, secret };
  }

  static buildRequestContent(method: string, params: Record<string, unknown>): string {
    return JSON.stringify({ method, params });
  }

  // ── WalletProvider interface ──

  async getInfo(): Promise<WalletProviderInfo> {
    const result = (await this.sendRequest('get_info', {})) as {
      alias?: string;
      methods?: string[];
    };
    return {
      alias: result.alias,
      methods: result.methods ?? [],
    };
  }

  async getBalance(): Promise<{ balance: number }> {
    const result = (await this.sendRequest('get_balance', {})) as { balance: number };
    return { balance: Math.round(result.balance / 1000) };
  }

  async payInvoice(bolt11: string): Promise<{ preimage: string }> {
    const result = (await this.sendRequest('pay_invoice', { invoice: bolt11 })) as {
      preimage: string;
    };
    return { preimage: result.preimage };
  }

  async makeInvoice(
    amount: number,
    memo?: string,
  ): Promise<{ bolt11: string; paymentHash: string }> {
    // NIP-47 make_invoice takes millisatoshis; our interface takes sats.
    const params: Record<string, unknown> = { amount: amount * 1000 };
    if (memo !== undefined) {
      params.description = memo;
    }
    const result = (await this.sendRequest('make_invoice', params)) as {
      invoice: string;
      payment_hash: string;
    };
    return { bolt11: result.invoice, paymentHash: result.payment_hash };
  }

  async lookupInvoice(paymentHash: string): Promise<{ paid: boolean; amountPaid?: number }> {
    try {
      const result = (await this.sendRequest('lookup_invoice', {
        payment_hash: paymentHash,
      })) as { settled_at?: number; amount?: number };
      const settledAt = result.settled_at ?? 0;
      const amountMsats = result.amount ?? 0;
      return {
        paid: settledAt > 0,
        amountPaid: Math.round(amountMsats / 1000),
      };
    } catch {
      this.assertAvailable();
      return { paid: false };
    }
  }

  async listTransactions(limit = 20, offset = 0): Promise<Transaction[]> {
    const result = await this.sendRequest('list_transactions', {
      limit,
      offset,
      unpaid: false,
    }) as { transactions?: Array<{
      type: string;
      invoice: string;
      amount: number;      // msats
      fees_paid: number;   // msats
      description: string;
      settled_at: number;
      created_at: number;
      payment_hash: string;
      preimage: string;
    }> };

    return (result.transactions ?? []).map(tx => ({
      paymentHash: tx.payment_hash,
      bolt11: tx.invoice,
      amount: tx.type === 'incoming'
        ? Math.round(tx.amount / 1000)
        : -Math.round(tx.amount / 1000),
      fee: Math.round((tx.fees_paid || 0) / 1000),
      memo: tx.description || undefined,
      status: 'settled' as const,
      createdAt: tx.settled_at || tx.created_at,
      preimage: tx.preimage || undefined,
    }));
  }

  async connect(): Promise<void> {
    this.assertAvailable();
    if (this.isConnected()) return;
    if (this.connecting) return this.connecting;
    const connection = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.relay);
      this.ws = ws;
      this.cancellations.add(reject);
      const finish = (error?: Error) => {
        this.cancellations.delete(reject);
        if (error) reject(error); else resolve();
      };
      ws.onopen = () => {
        if (this.disposed || this.ws !== ws) {
          ws.close(); finish(new Error('NWC disconnected')); return;
        }
        try {
          const pubkeyHex = this.getPubkeyHex();
          ws.send(JSON.stringify([
            'REQ', 'nwc-sub',
            { kinds: [23195], authors: [this.walletPubkey], '#p': [pubkeyHex] },
          ]));
          this._connected = true;
          finish();
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
          ws.close();
        }
      };
      ws.onerror = () => {
        finish(new Error('NWC WebSocket connection failed'));
        ws.close();
      };
      ws.onmessage = (event) => {
        if (!this.disposed && this.ws === ws) void this.handleMessage(event.data as string);
      };
      ws.onclose = () => {
        finish(new Error('NWC disconnected'));
        if (this.ws === ws) {
          this.ws = null;
          this._connected = false;
        }
      };
    });
    this.connecting = connection;
    try { await connection; } finally { if (this.connecting === connection) this.connecting = null; }
  }

  disconnect(): void {
    this.disposed = true;
    for (const cancel of this.cancellations) cancel(new Error('NWC disconnected'));
    this.cancellations.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    // E3: Zero secret key material on disconnect
    this.secret.fill(0);

    // Reject all in-flight requests
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('NWC disconnected'));
      this.pending.delete(id);
    }
  }

  isConnected(): boolean {
    return this._connected && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // ── Private ──

  private getPubkeyHex(): string {
    const pubkey = this.deps.getPubkey(this.secret);
    return typeof pubkey === 'string' ? pubkey : bytesToHex(pubkey);
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('NWC disconnected (NWC not connected)');
  }

  private assertSocket(ws: WebSocket): void {
    this.assertAvailable();
    if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) throw new Error('NWC not connected');
  }

  private async sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.assertAvailable();
    let cancel!: (error: Error) => void;
    const canceled = new Promise<never>((_resolve, reject) => { cancel = reject; });
    this.cancellations.add(cancel);
    try { return await Promise.race([this.performRequest(method, params), canceled]); }
    finally { this.cancellations.delete(cancel); }
  }

  private async performRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.assertAvailable();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('NWC not connected');

    const content = NwcProvider.buildRequestContent(method, params);
    const walletPubkeyBytes = hexToBytes(this.walletPubkey);
    const encrypted = await this.deps.encrypt(content, this.secret, walletPubkeyBytes);

    this.assertSocket(ws);
    const pubkeyHex = this.getPubkeyHex();

    const unsignedEvent: UnsignedEvent = {
      pubkey: pubkeyHex,
      kind: 23194,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', this.walletPubkey]],
      content: encrypted,
    };

    const signed = await this.deps.signEvent(unsignedEvent, this.secret);
    this.assertSocket(ws);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(signed.id);
        reject(new Error(`NWC request timed out: ${method}`));
      }, NWC_REQUEST_TIMEOUT_MS);

      this.pending.set(signed.id, { resolve, reject, timer });

      try { ws.send(JSON.stringify(['EVENT', signed])); }
      catch (error) {
        clearTimeout(timer); this.pending.delete(signed.id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async handleMessage(raw: string): Promise<void> {
    if (this.disposed) return;
    let parsed: unknown[];
    try {
      parsed = JSON.parse(raw) as unknown[];
    } catch {
      return; // Ignore non-JSON messages
    }

    if (!Array.isArray(parsed) || parsed[0] !== 'EVENT' || !parsed[2]) {
      return;
    }

    const event = parsed[2] as SignedEvent;
    if (event.kind !== 23195) return;

    // S-19: Verify the response actually came from the wallet service
    if (event.pubkey !== this.walletPubkey) return;

    // Anyone can put the wallet's pubkey on an event; require a valid
    // schnorr signature before correlating with a pending request, so a
    // malicious relay can't forge responses.
    const verify = this.deps.verifyEvent ?? verifyEventNip01;
    if (!(await verify(event)) || this.disposed) return;

    // Find the 'e' tag that references the original request
    const eTag = event.tags?.find((t) => t[0] === 'e');
    if (!eTag || !eTag[1]) return;

    const requestId = eTag[1];
    const entry = this.pending.get(requestId);
    if (!entry) return;

    const walletPubkeyBytes = hexToBytes(this.walletPubkey);
    let decrypted: string;
    try {
      decrypted = await this.deps.decrypt(event.content, this.secret, walletPubkeyBytes);
    } catch {
      // Undecryptable — not a genuine response. Keep the pending entry so
      // the real response (or the timeout) can still settle the request.
      return;
    }

    if (this.disposed || this.pending.get(requestId) !== entry) return;

    // Only a verified, decryptable response consumes the pending request.
    clearTimeout(entry.timer);
    this.pending.delete(requestId);

    try {
      const content = JSON.parse(decrypted) as NwcResponseContent;

      if (content.error) {
        entry.reject(new Error(`NWC error (${content.error.code}): ${content.error.message}`));
      } else {
        entry.resolve(content.result ?? {});
      }
    } catch (err) {
      entry.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

