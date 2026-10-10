// ── Wallet Configuration ──

export type WalletConfig =
  | { type: 'nwc'; connectionString: string; relay?: string }
  | { type: 'lnbits'; instanceUrl: string; adminKey: string; walletId?: string; nwcUri?: string };

// ── Wallet Provider ──

export interface WalletProviderInfo {
  alias?: string;
  methods: string[];
}

/** What a caller may demand of a send. */
export interface PayInvoiceOptions {
  /**
   * Refuse rather than send if the routing fee could exceed this, in msat.
   *
   * Enforced on the client by quoting first: no backend here accepts a fee limit.
   * A provider that cannot establish the fee must refuse the payment rather than
   * send it unbounded, so passing this is always a real bound or an error.
   */
  maxFeeMsat?: number;
}

/** A pre-flight fee, or null where this deployment cannot answer one. */
export interface FeeQuote {
  feeMsat: number | null;
}

export interface WalletProvider {
  readonly type: 'nwc' | 'lnbits';
  getInfo(): Promise<WalletProviderInfo>;
  getBalance(): Promise<{ balance: number }>;
  payInvoice(bolt11: string, opts?: PayInvoiceOptions): Promise<{ preimage: string }>;
  /**
   * The fee this send would be allowed to cost, before sending.
   *
   * Optional, and its ABSENCE is the capability signal: a provider that omits it
   * cannot bound a fee, and a caller must decide what to do about that rather than
   * assume a bound was applied.
   */
  quoteSend?(bolt11: string): Promise<FeeQuote>;
  makeInvoice(amount: number, memo?: string): Promise<{ bolt11: string; paymentHash: string }>;
  lookupInvoice(paymentHash: string): Promise<{ paid: boolean; amountPaid?: number }>;
  listTransactions(limit?: number, offset?: number): Promise<Transaction[]>;
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
}

// ── Transaction ──

export interface Transaction {
  paymentHash: string;
  bolt11?: string;
  amount: number;        // sats, positive = incoming, negative = outgoing
  fee?: number;          // sats
  memo?: string;
  status: 'settled' | 'pending' | 'failed';
  createdAt: number;     // unix timestamp
  preimage?: string;
}

// ── Safe Wallet Info (no secrets) ──

export interface SafeWalletInfo {
  type: 'nwc' | 'lnbits';
  connected: boolean;
  alias?: string;
  instanceUrl?: string;
}
