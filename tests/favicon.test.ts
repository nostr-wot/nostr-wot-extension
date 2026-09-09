import { it } from 'node:test';
import assert from 'node:assert/strict';
import browser from './helpers/browser-mock.ts';
import { getCachedFavicon, getFaviconUrl } from '../src/services/media/favicon.ts';

it('favicon reads reuse both in-flight work and persistent image bytes', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async input => {
    requests++;
    assert.equal(input, getFaviconUrl('cache.example'));
    return new Response(new Uint8Array([137,80,78,71]), { headers: { 'content-type': 'image/png' } });
  };
  try {
    const [a,b] = await Promise.all([getCachedFavicon('CACHE.EXAMPLE'), getCachedFavicon('cache.example')]);
    assert.equal(a,b);
    assert.match(a!, /^data:image\/png;base64,/);
    assert.equal(requests, 1);
    assert.equal(await getCachedFavicon('cache.example'), a);
    assert.equal(requests, 1);
    const data = await browser.storage.local.get('faviconCache');
    assert.equal(data.faviconCache['cache.example'].url, a);
  } finally { globalThis.fetch = original; }
});
it('favicon cache uses a saved fresh icon without any network request', async () => {
  await browser.storage.local.set({ faviconCache: { 'saved.example': { url: 'data:image/png;base64,aGVsbG8=', fetchedAt: Date.now() } } });
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Network must not be used'); };
  try { assert.equal(await getCachedFavicon('saved.example'), 'data:image/png;base64,aGVsbG8='); }
  finally { globalThis.fetch = original; }
});
it('favicon failures and invalid domains keep a safe reusable fallback', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('CORS'); };
  try {
    assert.equal(await getCachedFavicon('https://invalid/path'), null);
    assert.equal(requests, 0);
    assert.equal(await getCachedFavicon('offline.example'), getFaviconUrl('offline.example'));
    assert.equal(await getCachedFavicon('offline.example'), getFaviconUrl('offline.example'));
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; }
});
