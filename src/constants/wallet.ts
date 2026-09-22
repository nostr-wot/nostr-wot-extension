import type { TxFilters } from '@domain/wallet/txFilter.ts';

/** NWC wallet request timeout (1 minute) */
export const NWC_REQUEST_TIMEOUT_MS = 60_000;
/** Finite capability discovery before a legacy wallet request. */
export const NWC_INFO_TIMEOUT_MS = 1_500;
/** Bound URI-driven sequential connection attempts. */
export const NWC_MAX_RELAYS = 5;

export const DEFAULT_LNBITS_URL = 'https://zaps.nostr-wot.com';

/** Cap on the pay-params body, so a hostile server cannot stream forever. */
export const LNURL_MAX_RESPONSE_BYTES = 64 * 1024;

/** Give up on an endpoint that will not answer. */
export const LNURL_REQUEST_TIMEOUT_MS = 15_000;

export const WALLET_DISPLAY_CACHE_PREFIX = 'walletDisplay_';

export const WALLET_AUTO_BUDGET_PREFIX = 'walletAutoBudget_';

/** Rolling allowance window for unattended WebLN invoice spending. */
export const WALLET_AUTO_BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;

export const PAYMENT_INTENTS_STORAGE_KEY = 'walletPaymentIntents';

/** How long a completed intent stays replayable. Retries happen in milliseconds; this is slack. */
export const PAYMENT_INTENT_TTL_MS = 10 * 60 * 1000;

/**
 * How long a record stuck at 'in-flight' is kept.
 *
 * Deliberately far longer than PAYMENT_INTENT_TTL_MS. An in-flight marker is the one record
 * that must not be pruned on a timer: dropping it is exactly what re-arms the
 * double payment it was written to prevent. Intent ids are per-click UUIDs, so
 * a stranded marker blocks nothing — it is a leak, not a lock — and this bound
 * exists only so the leak cannot grow without limit.
 */
export const PAYMENT_INTENT_STUCK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Wallet provider types for Lightning/Zaps support
 * @module constants/wallet
 */

// ── Error codes ──

/**
 * Raised when a payment replay arrives while the first attempt is still running.
 * See services/wallet/payment-intents.ts.
 *
 * A stable code rather than a sentence, because it crosses the RPC boundary as
 * an error message and is rendered to the user — an English sentence thrown in
 * the background is an English sentence shown in all six locales. It lives here,
 * in the one wallet module that imports nothing, so the popup can recognise it
 * without pulling the background's storage shim into its bundle.
 */
export const PAYMENT_IN_FLIGHT = 'PAYMENT_IN_FLIGHT';

/** Published payment without a trustworthy final response; never automatically retry. */
export const PAYMENT_OUTCOME_UNKNOWN = 'PAYMENT_OUTCOME_UNKNOWN';

export const EMPTY_TX_FILTERS: TxFilters = { direction: 'all', dateFrom: '', dateTo: '' };

export const PROVIDER_LABELS: Record<string, string> = {
  nwc: 'Nostr Wallet Connect',
  lnbits: 'LNbits',
};
