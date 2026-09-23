import { PaymentOutcomeUnknownError } from './payment-errors.ts';
import { NWC_REQUEST_TIMEOUT_MS, NWC_INFO_TIMEOUT_MS, NWC_MAX_RELAYS } from '@constants/wallet.ts';
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
  relays: string[];
  secret: string;
}

// ── Crypto dependency injection ──

export interface NwcCryptoDeps {
  encrypt(plaintext: string, privkey: Uint8Array, theirPubkey: Uint8Array): Promise<string>;
  decrypt(ciphertext: string, privkey: Uint8Array, theirPubkey: Uint8Array): Promise<string>;
  encryptNip44?(plaintext: string, privkey: Uint8Array, theirPubkey: Uint8Array): Promise<string>;
  decryptNip44?(ciphertext: string, privkey: Uint8Array, theirPubkey: Uint8Array): Promise<string>;
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
  method: string;
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

class UnsupportedNwcEncryptionError extends Error {
  constructor() { super('Unsupported NWC encryption'); }
}

class NwcRequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(`NWC error (${code}): ${message}`);
  }
}

function requireMsats(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid NWC amount');
}

function requireText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value) throw new Error('Invalid NWC result string');
}

function requireHex32(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) throw new Error('Invalid NWC result: expected 32-byte hex');
}

// ── Provider ──

export class NwcProvider implements WalletProvider {
  readonly type = 'nwc' as const;

  private readonly walletPubkey: string;
  private readonly relays: string[];
  private encryption: 'nip04' | 'nip44_v2' = 'nip04';
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
    this.relays = parsed.relays;
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

    const relays = [...new Set(params.getAll('relay').filter(Boolean))];
    if (relays.length > NWC_MAX_RELAYS) throw new Error(`Invalid NWC URI: at most ${NWC_MAX_RELAYS} relays`);
    return { walletPubkey, relay, relays, secret };
  }

  static buildRequestContent(method: string, params: Record<string, unknown>): string {
    return JSON.stringify({ method, params });
  }

  // ── WalletProvider interface ──

  async getInfo(): Promise<WalletProviderInfo> {
    const result = (await this.sendRequest('get_info', {})) as {
      alias?: string | null;
      methods?: string[];
    };
    if ((result.alias != null && typeof result.alias !== 'string') ||
        (result.methods !== undefined && (!Array.isArray(result.methods) || result.methods.some(method => typeof method !== 'string')))) {
      throw new Error('Invalid NWC info result');
    }
    return {
      alias: result.alias ?? undefined,
      methods: result.methods ?? [],
    };
  }

  async getBalance(): Promise<{ balance: number }> {
    const result = (await this.sendRequest('get_balance', {})) as { balance: number };
    requireMsats(result.balance);
    return { balance: Math.round(result.balance / 1000) };
  }

  async payInvoice(bolt11: string): Promise<{ preimage: string }> {
    const result = (await this.sendRequest('pay_invoice', { invoice: bolt11 })) as {
      preimage: string;
    };
    try { requireHex32(result.preimage); } catch (error) {
      throw new PaymentOutcomeUnknownError((error as Error).message);
    }
    return { preimage: result.preimage };
  }

  async makeInvoice(
    amount: number,
    memo?: string,
  ): Promise<{ bolt11: string; paymentHash: string }> {
    if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(amount * 1000)) {
      throw new Error('Invalid invoice amount: expected positive whole sats within the millisatoshi range');
    }
    // NIP-47 make_invoice takes millisatoshis; our interface takes sats.
    const params: Record<string, unknown> = { amount: amount * 1000 };
    if (memo !== undefined) {
      params.description = memo;
    }
    const result = (await this.sendRequest('make_invoice', params)) as {
      invoice: string;
      payment_hash: string;
    };
    requireText(result.invoice);
    requireHex32(result.payment_hash);
    return { bolt11: result.invoice, paymentHash: result.payment_hash };
  }

  async lookupInvoice(paymentHash: string): Promise<{ paid: boolean; amountPaid?: number }> {
    try {
      const result = (await this.sendRequest('lookup_invoice', {
        payment_hash: paymentHash,
      })) as { settled_at?: number | null; amount?: number };
      requireMsats(result.amount);
      if (result.settled_at != null && (!Number.isSafeInteger(result.settled_at) || result.settled_at < 0)) {
        throw new Error('Invalid NWC settlement time');
      }
      const settledAt = result.settled_at ?? 0;
      const amountMsats = result.amount ?? 0;
      return {
        paid: settledAt > 0,
        amountPaid: Math.round(amountMsats / 1000),
      };
    } catch (error) {
      this.assertAvailable();
      if (error instanceof NwcRequestError && error.code === 'NOT_FOUND') return { paid: false };
      throw error;
    }
  }

  async listTransactions(limit = 20, offset = 0): Promise<Transaction[]> {
    const result = await this.sendRequest('list_transactions', {
      limit,
      offset,
      unpaid: false,
    }) as { transactions?: Array<{
      type: string;
      state?: string;
      invoice: string;
      amount: number;      // msats
      fees_paid: number;   // msats
      description: string;
      settled_at: number;
      created_at: number;
      payment_hash: string;
      preimage: string;
    }> };

    if (!Array.isArray(result.transactions)) throw new Error('Invalid NWC transactions');
    return result.transactions.map(tx => {
      if (!tx || (tx.type !== 'incoming' && tx.type !== 'outgoing')) throw new Error('Invalid NWC transaction');
      for (const value of [tx.invoice, tx.description]) {
        if (value != null && typeof value !== 'string') throw new Error('Invalid NWC transaction text');
      }
      if (tx.preimage) requireHex32(tx.preimage);
      requireMsats(tx.amount);
      // LNbits reports outgoing fees as negative; both signs represent a cost.
      if (tx.fees_paid != null && !Number.isSafeInteger(tx.fees_paid)) throw new Error('Invalid NWC fee');
      requireHex32(tx.payment_hash);
      const timestamp = tx.settled_at || tx.created_at;
      if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('Invalid NWC transaction time');
      return {
        paymentHash: tx.payment_hash,
        bolt11: tx.invoice ?? undefined,
        amount: tx.type === 'incoming'
          ? Math.round(tx.amount / 1000)
          : -Math.round(tx.amount / 1000),
        fee: Math.round(Math.abs(tx.fees_paid ?? 0) / 1000),
        memo: tx.description || undefined,
        status: tx.state === 'failed' ? 'failed' as const
          : tx.state === 'pending' || tx.state === 'accepted' || !tx.settled_at ? 'pending' as const
          : 'settled' as const,
        createdAt: tx.settled_at || tx.created_at,
        preimage: tx.preimage || undefined,
      };
    });
  }

  async connect(): Promise<void> {
    this.assertAvailable();
    if (this.isConnected()) return;
    if (this.connecting) return this.connecting;
    const connection = this.connectRelays();
    this.connecting = connection;
    try { await connection; } finally { if (this.connecting === connection) this.connecting = null; }
  }

  private async connectRelays(): Promise<void> {
    let lastError: unknown;
    for (const relay of this.relays) {
      this.assertAvailable();
      try {
        await this.connectRelay(relay, Math.floor(NWC_REQUEST_TIMEOUT_MS / this.relays.length));
        return;
      } catch (error) {
        if (error instanceof UnsupportedNwcEncryptionError) throw error;
        lastError = error;
      }
    }
    this.assertAvailable();
    throw lastError;
  }

  private connectRelay(relay: string, timeout: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(relay);
      this.ws = ws;
      let discovering = false;
      let failed = false;
      let discoveryTimer: ReturnType<typeof setTimeout> | undefined;
      let discoveryQueue = Promise.resolve();
      let newestInfo: SignedEvent | undefined;
      const finish = (error?: Error) => {
        clearTimeout(timer);
        clearTimeout(discoveryTimer);
        discovering = false;
        this.cancellations.delete(finish);
        if (error) reject(error); else resolve();
      };
      const fail = (error: Error) => {
        if (failed) return;
        failed = true;
        finish(error);
        if (this.ws === ws) {
          this.ws = null;
          this._connected = false;
          this.rejectRequests(error);
        }
        ws.close();
      };
      const timer = setTimeout(() => fail(new Error('NWC connection timed out')), timeout);
      this.cancellations.add(finish);
      const subscribeResponses = () => {
        this.assertSocket(ws);
        ws.send(JSON.stringify(['REQ', 'nwc-sub',
          { kinds: [23195], authors: [this.walletPubkey], '#p': [this.getPubkeyHex()] }]));
        this._connected = true;
        finish();
      };
      const finishDiscovery = () => {
        if (!discovering || this.disposed || this.ws !== ws) return;
        discovering = false;
        clearTimeout(discoveryTimer);
        try {
          const advertised = newestInfo?.tags.find(tag => tag[0] === 'encryption')?.[1];
          const schemes = advertised?.split(/\s+/) ?? ['nip04'];
          if (schemes.includes('nip44_v2')) this.encryption = 'nip44_v2';
          else if (schemes.includes('nip04')) this.encryption = 'nip04';
          else throw new UnsupportedNwcEncryptionError();
          ws.send(JSON.stringify(['CLOSE', 'nwc-info']));
          subscribeResponses();
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      };
      const readDiscovery = async (raw: string) => {
        if (!discovering) return;
        let message: unknown[];
        try { message = JSON.parse(raw); } catch { return; }
        if (!Array.isArray(message) || message[1] !== 'nwc-info') return;
        if (message[0] === 'EOSE') { finishDiscovery(); return; }
        const event = message[2] as SignedEvent;
        if (message[0] !== 'EVENT' || !event || event.kind !== 13194 || event.pubkey !== this.walletPubkey ||
            !Number.isSafeInteger(event.created_at) || !Array.isArray(event.tags) ||
            event.tags.some(tag => !Array.isArray(tag) || tag.some(value => typeof value !== 'string'))) return;
        try {
          if (!await (this.deps.verifyEvent ?? verifyEventNip01)(event)) return;
          if (discovering && !this.disposed && this.ws === ws && (!newestInfo || event.created_at > newestInfo.created_at)) newestInfo = event;
        } catch { /* Invalid advertisements cannot select a cipher. */ }
      };
      ws.onopen = () => {
        if (this.disposed || this.ws !== ws) { ws.close(); finish(new Error('NWC disconnected')); return; }
        try {
          this.encryption = 'nip04';
          if (this.deps.encryptNip44 && this.deps.decryptNip44) {
            discovering = true;
            discoveryTimer = setTimeout(finishDiscovery, NWC_INFO_TIMEOUT_MS);
            ws.send(JSON.stringify(['REQ', 'nwc-info', { kinds: [13194], authors: [this.walletPubkey] }]));
          } else subscribeResponses();
        } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
      };
      ws.onerror = () => fail(new Error('NWC WebSocket connection failed'));
      ws.onmessage = (event) => {
        if (this.disposed || this.ws !== ws) return;
        if (discovering) {
          discoveryQueue = discoveryQueue.then(() => readDiscovery(event.data as string));
        } else void this.handleMessage(event.data as string);
      };
      ws.onclose = () => {
        finish(new Error('NWC disconnected'));
        if (this.ws === ws) {
          this.ws = null;
          this._connected = false;
          this.rejectRequests(new Error('NWC disconnected; payment outcome may be unknown'));
        }
      };
    });
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

    this.rejectRequests(new Error('NWC disconnected; payment outcome may be unknown'));
  }

  private rejectRequests(error: Error): void {
    for (const cancel of this.cancellations) cancel(error);
    this.cancellations.clear();
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
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
    let dispatched = false;
    let cancel!: (error: Error) => void;
    const canceled = new Promise<never>((_resolve, reject) => { cancel = reject; });
    this.cancellations.add(cancel);
    try { return await Promise.race([this.performRequest(method, params, () => { dispatched = true; }), canceled]); }
    catch (error) {
      if (method === 'pay_invoice' && dispatched && !(error instanceof NwcRequestError)) {
        throw new PaymentOutcomeUnknownError(error instanceof Error ? error.message : String(error));
      }
      throw error;
    }
    finally { this.cancellations.delete(cancel); }
  }

  private async performRequest(method: string, params: Record<string, unknown>, onDispatched: () => void): Promise<unknown> {
    this.assertAvailable();
    const ws = this.ws;
    if (!this._connected || !ws || ws.readyState !== WebSocket.OPEN) throw new Error('NWC not connected');

    const content = NwcProvider.buildRequestContent(method, params);
    const walletPubkeyBytes = hexToBytes(this.walletPubkey);
    const encryption = this.encryption;
    const encrypt = encryption === 'nip44_v2' ? this.deps.encryptNip44! : this.deps.encrypt;
    const encrypted = await encrypt(content, this.secret, walletPubkeyBytes);

    this.assertSocket(ws);
    const pubkeyHex = this.getPubkeyHex();

    const unsignedEvent: UnsignedEvent = {
      pubkey: pubkeyHex,
      kind: 23194,
      created_at: Math.floor(Date.now() / 1000),
      tags: encryption === 'nip44_v2' ? [['p', this.walletPubkey], ['encryption', 'nip44_v2']] : [['p', this.walletPubkey]],
      content: encrypted,
    };

    const signed = await this.deps.signEvent(unsignedEvent, this.secret);
    this.assertSocket(ws);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(signed.id);
        reject(new Error(`NWC request timed out: ${method}`));
      }, NWC_REQUEST_TIMEOUT_MS);

      this.pending.set(signed.id, { method, resolve, reject, timer });

      try { ws.send(JSON.stringify(['EVENT', signed])); onDispatched(); }
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
    if (!event || event.kind !== 23195 || typeof event.content !== 'string' ||
        !Array.isArray(event.tags) || event.tags.some(tag => !Array.isArray(tag) || tag.some(value => typeof value !== 'string'))) return;

    // S-19: Verify the response actually came from the wallet service
    if (event.pubkey !== this.walletPubkey) return;

    // Anyone can put the wallet's pubkey on an event; require a valid
    // schnorr signature before correlating with a pending request, so a
    // malicious relay can't forge responses.
    const verify = this.deps.verifyEvent ?? verifyEventNip01;
    try { if (!(await verify(event)) || this.disposed) return; }
    catch { return; }

    // Find the 'e' tag that references the original request
    const eTag = event.tags?.find((t) => t[0] === 'e');
    if (!eTag || !eTag[1]) return;

    const requestId = eTag[1];
    const entry = this.pending.get(requestId);
    if (!entry) return;

    const walletPubkeyBytes = hexToBytes(this.walletPubkey);
    let decrypted: string;
    try {
      const decrypt = this.encryption === 'nip44_v2' ? this.deps.decryptNip44! : this.deps.decrypt;
      decrypted = await decrypt(event.content, this.secret, walletPubkeyBytes);
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

      if (!content || content.result_type !== entry.method) throw new Error('Invalid NWC result_type');
      if (content.error) {
        if (typeof content.error.code !== 'string' || typeof content.error.message !== 'string') throw new Error('Invalid NWC error result');
        entry.reject(new NwcRequestError(content.error.code, content.error.message));
      } else {
        if (!content.result || typeof content.result !== 'object' || Array.isArray(content.result)) {
          throw new Error('Invalid NWC result');
        }
        entry.resolve(content.result);
      }
    } catch (err) {
      entry.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

