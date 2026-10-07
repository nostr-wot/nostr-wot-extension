/**
 * initI18n() runs in front of the popup's first render, so nothing it waits
 * for may be slow without reason: not storage.sync when local already knows
 * the language, and not a fetch of the English strings the bundle carries.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import browser, { resetMockStorage } from './helpers/browser-mock.ts';

(globalThis as Record<string, unknown>).document ??= { documentElement: { lang: '' } };
const { initI18n, t } = await import('../src/services/i18n/i18n.ts');

describe('initI18n', () => {
  const originalSyncGet = browser.storage.sync.get;
  const originalFetch = globalThis.fetch;
  let fetches: string[];

  beforeEach(() => {
    resetMockStorage();
    fetches = [];
    globalThis.fetch = (async (url: string) => {
      fetches.push(String(url));
      return { ok: true, json: async () => ({ 'common.loading': 'Cargando…' }) };
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    browser.storage.sync.get = originalSyncGet;
    globalThis.fetch = originalFetch;
  });

  it('uses the bundled English strings without fetching them', async () => {
    assert.equal(await initI18n(), 'en');
    assert.deepEqual(fetches, []);
    assert.notEqual(t('common.loading'), 'common.loading');
  });

  it('answers from local without waiting for a storage.sync that never returns', async () => {
    await browser.storage.local.set({ language: 'es' });
    browser.storage.sync.get = (() => new Promise(() => {})) as typeof browser.storage.sync.get;
    assert.equal(await initI18n(), 'es');
    assert.equal(t('common.loading'), 'Cargando…');
  });

  it('falls back to sync when local has no language, and remembers it locally', async () => {
    await browser.storage.sync.set({ language: 'es' });
    assert.equal(await initI18n(), 'es');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal((await browser.storage.local.get('language')).language, 'es');
  });

  it('copies a language changed on another synced device into local for the next open', async () => {
    await browser.storage.local.set({ language: 'en' });
    await browser.storage.sync.set({ language: 'es' });
    assert.equal(await initI18n(), 'en');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal((await browser.storage.local.get('language')).language, 'es');
  });
});
