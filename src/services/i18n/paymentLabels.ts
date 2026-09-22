import { t } from './i18n.ts';
import { PAYMENT_IN_FLIGHT, PAYMENT_OUTCOME_UNKNOWN } from '@constants/wallet.ts';
import { describeInvoiceExpiry } from '@domain/wallet/invoiceExpiry.ts';

/**
 * Turn a payment failure into something worth showing.
 *
 * Most of what reaches here is an LNURL or provider message written in English
 * in the background, which is its own problem; the codes the background raises
 * deliberately are at least translated. Anything unrecognised is passed through
 * rather than replaced by a generic string — a specific English reason beats an
 * accurate but useless one.
 */
export function paymentErrorMessage(e: unknown): string {
  const message = (e as Error)?.message || '';
  if (message.includes(PAYMENT_IN_FLIGHT)) return t('wallet.paymentInFlight');
  if (message.includes(PAYMENT_OUTCOME_UNKNOWN)) return t('wallet.paymentOutcomeUnknown');
  return message;
}

/** Turns the pure expiry shape into the translated string the row shows. */
export function invoiceExpiryLabel(inv: { timestamp: number; expiry: number }): string {
  const e = describeInvoiceExpiry(inv.timestamp, inv.expiry, Date.now());
  if (e.state === 'expired') return t('wallet.invoiceExpired');
  if (e.state === 'minutes') return t('wallet.invoiceMinutes', { n: e.n });
  return t('wallet.invoiceHours', { n: e.n });
}
