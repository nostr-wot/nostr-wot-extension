/**
 * Returns a Google favicon URL for any domain.
 */
export function getFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

import browser from '@lib/browser.ts';
import { AsyncLock } from '@utils/asyncLock.ts';

const TTL = 7 * 24 * 60 * 60 * 1000;
const pending = new Map<string, Promise<string | null>>();
const writes = new AsyncLock();
type IconRecord = { url: string; fetchedAt: number };

/** Reuse one request per domain and persist bounded, validated image responses.
 * Where the image service disallows CORS, use its original URL and the browser's
 * HTTP image cache. Never request additional host permissions just for an icon. */
export function getCachedFavicon(rawDomain: string): Promise<string | null> {
  const domain = rawDomain.trim().toLowerCase();
  if (!domain || !/^[a-z0-9.-]+(?::\d+)?$/.test(domain)) return Promise.resolve(null);
  const existing = pending.get(domain);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const stored = await browser.storage.local.get('faviconCache');
      const cached = (stored.faviconCache as Record<string, IconRecord> | undefined)?.[domain];
      if (cached && Date.now() - cached.fetchedAt < TTL && /^data:image\/(png|jpeg|webp|gif|x-icon|vnd.microsoft.icon);base64,/.test(cached.url)) return cached.url;
    } catch { /* Storage is an optimization; the icon can still load. */ }
    const url = getFaviconUrl(domain);
    try {
      const response = await fetch(url, { credentials: 'omit', cache: 'force-cache', signal: AbortSignal.timeout(5000) });
      const type = response.headers.get('content-type')?.split(';')[0];
      if (!response.ok || !type || !/^image\/(png|jpeg|webp|gif|x-icon|vnd.microsoft.icon)$/.test(type)) return url;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 32768) return url;
      const dataUrl = `data:${type};base64,${btoa(String.fromCharCode(...bytes))}`;
      await writes.run(async () => {
        const stored = await browser.storage.local.get('faviconCache');
        const cache = (stored.faviconCache || {}) as Record<string, IconRecord>;
        cache[domain] = { url: dataUrl, fetchedAt: Date.now() };
        const newest = Object.entries(cache).sort((a,b) => b[1].fetchedAt - a[1].fetchedAt).slice(0,128);
        await browser.storage.local.set({ faviconCache: Object.fromEntries(newest) });
      });
      return dataUrl;
    } catch { return url; }
  })();
  pending.set(domain, promise);
  // Bound the popup's memory as well as persistent storage.
  if (pending.size > 128) pending.delete(pending.keys().next().value!);
  return promise;
}
