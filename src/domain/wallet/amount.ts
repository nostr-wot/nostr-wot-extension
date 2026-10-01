/** Keep all three millisatoshi digits, including amounts below one satoshi. */
export function formatMsats(msats: string, locale: string): string {
  const value = BigInt(msats);
  const whole = (value / 1000n).toLocaleString(locale);
  const fraction = (value % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal')?.value || '.';
  return fraction ? `${whole}${decimal}${fraction}` : whole;
}

/** Queued WebLN amounts originate in our BOLT11 decoder, in sats. */
export function paymentMsats(amount?: number): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  const msats = Math.round(amount * 1000);
  return Number.isSafeInteger(msats) && msats > 0 ? String(msats) : null;
}
