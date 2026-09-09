export function getInitial(name: string | null | undefined): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

export function truncate(s: string | null | undefined, maxLen: number): string {
  return s && s.length > maxLen ? s.slice(0, maxLen) + '...' : (s || '');
}

/**
 * Shorten a long opaque value, keeping both ends.
 *
 * For things like keys, where the middle carries no meaning a reader can use but
 * the ends are what someone checks a value by. Truncating only the tail (the
 * `truncate` above) hides exactly the half people compare against.
 *
 * Returns the value unchanged when shortening it would not actually save
 * anything.
 */
export function truncateMiddle(s: string | null | undefined, head = 10, tail = 8): string {
  if (!s) return '';
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}
