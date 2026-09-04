/**
 * Sanitizer for untrusted (relay-supplied) image URLs.
 *
 * Profile metadata (`picture`, `banner`) comes straight from relays, so it
 * must never reach an `<img src>` / `background-image` unless it is a plain
 * http(s) URL. Everything else — `javascript:`, `data:`, `blob:`,
 * `vbscript:`, relative paths, scheme-obfuscation tricks — is rejected.
 *
 * @module src/shared/safeUrl
 */

/**
 * Returns the URL only if it parses as an absolute `http:`/`https:` URL,
 * otherwise `undefined`. The WHATWG URL parser normalizes case, whitespace,
 * and embedded control characters, so obfuscated schemes (e.g. `jAvA\tscript:`)
 * are caught too.
 */
export function safeImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Relative or malformed — untrusted input gets no base URL.
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  return url;
}
