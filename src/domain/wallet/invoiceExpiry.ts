/**
 * How long a Lightning invoice has left.
 *
 * Was an IIFE inside the send dialog's JSX that read `Date.now()` at render
 * time — so it recomputed on every keystroke in the amount field and could not
 * be tested at all. Taking `now` as an argument is what makes it testable; the
 * caller passes `Date.now()`.
 *
 * Returns a shape rather than a string because the labels are translated and
 * the pluralisation belongs to i18n, not here.
 */

export type InvoiceExpiry =
  | { state: 'expired' }
  | { state: 'minutes'; n: number }
  | { state: 'hours'; n: number };

/**
 * @param timestampSec bolt11 `timestamp` field (epoch seconds)
 * @param expirySec    bolt11 `expiry` field (seconds from timestamp)
 * @param nowMs        current time in ms
 */
export function describeInvoiceExpiry(
  timestampSec: number,
  expirySec: number,
  nowMs: number,
): InvoiceExpiry {
  const remainingMs = (timestampSec + expirySec) * 1000 - nowMs;
  if (remainingMs <= 0) return { state: 'expired' };

  // Round up: with 30 seconds left, "1 minute" is honest and "0 minutes" is not.
  const minutes = Math.ceil(remainingMs / 60000);
  if (minutes < 60) return { state: 'minutes', n: minutes };
  return { state: 'hours', n: Math.round(minutes / 60) };
}
