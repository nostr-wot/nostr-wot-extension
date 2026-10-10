import { transactionMemo } from '@domain/wallet/transaction-memo.ts';
/**
 * LNbits wallet provider implementation
 * @module services/wallet/lnbits
 */

import { PaymentOutcomeUnknownError } from './payment-errors.ts';
import type { WalletProvider, WalletProviderInfo, Transaction, PayInvoiceOptions, FeeQuote } from '../../domain/wallet/types.ts';
import { PAYMENT_FEE_TOO_HIGH, PAYMENT_FEE_UNKNOWN } from '@constants/wallet.ts';

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
  /**
   * Whether this instance answers the fee-reserve endpoint.
   *
   * null until asked, then cached, because the answer is a property of the
   * deployment rather than of the invoice. Older proxy builds and LNbits instances
   * that do not expose it answer 404 once and are not asked again.
   */
  private feeReserveReachable: boolean | null = null;

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

  /**
   * The ceiling LNbits would apply to this payment, in msat, or null.
   *
   * `GET /api/v1/payments/fee-reserve?invoice=<bolt11>` answers
   * `{"fee_reserve": <msat>}`, and that is the `fee_limit_msat` LNbits passes to its
   * funding source — a genuine ceiling on what the payment can cost, not a guess at
   * what a route will cost. Already msat, and deliberately not converted: it is the
   * one figure on this API that is msat where a reader expects sats.
   */
  async quoteSend(bolt11: string): Promise<FeeQuote> {
    if (this.feeReserveReachable === false) return { feeMsat: null };
    try {
      const data = await this.request<{ fee_reserve?: unknown }>(
        'GET',
        `/api/v1/payments/fee-reserve?invoice=${encodeURIComponent(bolt11)}`,
      );
      const reserve = data?.fee_reserve;
      if (typeof reserve !== 'number' || !Number.isSafeInteger(reserve) || reserve < 0) {
        this.feeReserveReachable = false;
        return { feeMsat: null };
      }
      this.feeReserveReachable = true;
      return { feeMsat: reserve };
    } catch (error) {
      // Only a deployment that says the path does not exist is remembered. A timeout,
      // a disconnect or a 5xx is this moment's problem, not this deployment's, and
      // caching it would keep asking the user to approve every later payment by hand.
      // walletHttp reports a refused status as `<prefix>: <status>`.
      if (/(^|\D)404$/.test((error as Error)?.message ?? '')) this.feeReserveReachable = false;
      return { feeMsat: null };
    }
  }

  async payInvoice(bolt11: string, opts?: PayInvoiceOptions): Promise<{ preimage: string }> {
    // A ceiling is enforced here, before dispatch, because LNbits accepts no fee
    // limit on the payment itself. An unquotable fee refuses the payment: sending it
    // anyway would report a bound that was never applied.
    if (opts?.maxFeeMsat !== undefined) {
      const { feeMsat } = await this.quoteSend(bolt11);
      if (feeMsat === null) throw new Error(PAYMENT_FEE_UNKNOWN);
      if (feeMsat > opts.maxFeeMsat) throw new Error(PAYMENT_FEE_TOO_HIGH);
    }
    const data = await this.request<{ preimage?: string; status?: string; pending?: boolean }>('POST', '/api/v1/payments', {
      out: true,
      bolt11,
    });
    if (data.status === 'failed') throw new Error('LNbits payment failed');
    // LNbits returns HTTP 200 for deferred/hold payments too. A successful
    // HTTP request is not settlement; never turn a pending row into a receipt.
    if (data.status === 'pending' || data.pending === true ||
        (data.status !== undefined && data.status !== 'success') ||
        typeof data.preimage !== 'string' || !data.preimage.trim()) {
      throw new PaymentOutcomeUnknownError('LNbits payment is not confirmed');
    }
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
      extra?: unknown;
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
        memo: transactionMemo(p.memo, p.extra),
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
