/**
 * LNbits wallet provider implementation
 * @module services/wallet/lnbits
 */

import type { WalletProvider, WalletProviderInfo, Transaction } from '../../domain/wallet/types.ts';

import type { FetchFn } from '@services/http/types.ts';
import { secureWalletUrl, walletHttp } from '@services/http/wallet.ts';

export interface LnbitsConfig {
  instanceUrl: string;
  adminKey: string;
}

export class LnbitsProvider implements WalletProvider {
  readonly type = 'lnbits' as const;

  private readonly instanceUrl: string;
  private adminKey: string;
  private readonly lifetime = new AbortController();
  private readonly fetchFn: FetchFn;
  private _connected = false;

  constructor(config: LnbitsConfig, fetchFn?: FetchFn) {
    this.instanceUrl = config.instanceUrl.replace(/\/+$/, '');
    this.adminKey = config.adminKey;
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  private assertAvailable(): void {
    if (this.lifetime.signal.aborted) throw new Error('LNbits provider disconnected');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    this.assertAvailable();
    secureWalletUrl(this.instanceUrl);
    const url = `${this.instanceUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        'X-Api-Key': this.adminKey,
        'Content-Type': 'application/json',
      },
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const result = await walletHttp<T>(url, init, this.fetchFn, 'LNbits API error', { signal: this.lifetime.signal });
    this.assertAvailable();
    return result;
  }

  async getInfo(): Promise<WalletProviderInfo> {
    const data = await this.request<{ name: string }>('GET', '/api/v1/wallet');
    return {
      alias: data.name,
      methods: ['pay_invoice', 'get_balance', 'make_invoice'],
    };
  }

  async getBalance(): Promise<{ balance: number }> {
    const data = await this.request<{ balance: number }>('GET', '/api/v1/wallet');
    return { balance: Math.round(data.balance / 1000) };
  }

  async payInvoice(bolt11: string): Promise<{ preimage: string }> {
    const data = await this.request<{ preimage: string }>('POST', '/api/v1/payments', {
      out: true,
      bolt11,
    });
    return { preimage: data.preimage };
  }

  async makeInvoice(amount: number, memo?: string): Promise<{ bolt11: string; paymentHash: string }> {
    const data = await this.request<{ payment_request: string; payment_hash: string }>(
      'POST',
      '/api/v1/payments',
      { out: false, amount, memo },
    );
    return { bolt11: data.payment_request, paymentHash: data.payment_hash };
  }

  async listTransactions(limit = 20, offset = 0): Promise<Transaction[]> {
    const data = await this.request<Array<{
      checking_id: string;
      payment_hash: string;
      bolt11: string;
      amount: number;       // msats in LNbits
      fee: number;          // msats
      memo: string;
      status: string;
      time: string | number; // ISO 8601 string or unix timestamp
      preimage: string;
    }>>('GET', `/api/v1/payments?limit=${limit}&offset=${offset}&status%5Bne%5D=pending&sortby=time&direction=desc`);

    // Keep the raw page length: filtering unpaid invoices here makes the
    // caller stop early and calculate the next offset incorrectly.
    return data.map(p => ({
        paymentHash: p.payment_hash,
        bolt11: p.bolt11,
        amount: Math.round(p.amount / 1000),   // msats → sats
        fee: Math.round((p.fee || 0) / 1000),
        memo: p.memo || undefined,
        status: p.status === 'success' ? 'settled' as const : p.status === 'pending' ? 'pending' as const : 'failed' as const,
        createdAt: typeof p.time === 'string'
          ? Math.floor(new Date(p.time).getTime() / 1000)
          : p.time,
        preimage: p.preimage || undefined,
      }));
  }

  async lookupInvoice(paymentHash: string): Promise<{ paid: boolean; amountPaid?: number }> {
    try {
      const data = await this.request<{
        paid: boolean;
        preimage?: string;
        details?: { amount?: number };
      }>('GET', `/api/v1/payments/${paymentHash}`);
      const msats = data.details?.amount ?? 0;
      return {
        paid: !!data.paid,
        amountPaid: Math.round(Math.abs(msats) / 1000),
      };
    } catch {
      this.assertAvailable();
      return { paid: false };
    }
  }

  async connect(): Promise<void> {
    await this.getBalance();
    this.assertAvailable();
    this._connected = true;
  }

  disconnect(): void {
    this._connected = false;
    this.adminKey = '';
    this.lifetime.abort(new Error('LNbits provider disconnected'));
  }

  isConnected(): boolean {
    return this._connected;
  }
}
