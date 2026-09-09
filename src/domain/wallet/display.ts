export function formatSats(n: number): string {
  return Math.round(n).toLocaleString() + ' sats';
}
