export function toPercent(value: number | null | undefined, defaultValue: number): number {
  return Math.round((value ?? defaultValue) * 100);
}

export function toFraction(value: string | number, defaultValue: number): number {
  const parsed = parseFloat(String(value));
  return isNaN(parsed) ? defaultValue : parsed / 100;
}

/** Format a sats amount as a rounded, grouped number with a " sats" suffix. */
export function formatSats(n: number): string {
  return Math.round(n).toLocaleString() + ' sats';
}
