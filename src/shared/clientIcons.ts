/**
 * Returns a Google favicon URL for any domain.
 */
export function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}
