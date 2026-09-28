import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { themeFromSearch, downloadTheme } from '../src/domain/appearance/handoff.ts';
import { openInstalledWelcome } from '../src/services/appearance/install.ts';

describe('download theme handoff', () => {
  it('accepts built-in themes only, with a single unambiguous parameter', () => {
    for (const name of ['coracle', 'nostrudel', 'yakihonne', 'nostrich', 'lacrypta', 'light', 'dark', 'system']) {
      assert.equal(themeFromSearch(`?theme=${name}&ref=anything`), name);
    }
    for (const search of ['', '?theme=custom', '?theme=unknown', '?theme=coracle&theme=nostrich', '?theme=url(red)']) {
      assert.equal(themeFromSearch(search), null);
    }
  });
  it('only trusts official HTTPS download URLs, including localized routes', () => {
    for (const path of ['/download', '/download/', '/es/download', '/pt/download/']) {
      assert.equal(downloadTheme(`https://nostr-wot.com${path}?theme=coracle`), 'coracle');
    }
    for (const url of ['https://evil.test/download?theme=coracle', 'https://nostr-wot.com.evil.test/download?theme=coracle', 'http://nostr-wot.com/download?theme=coracle', 'https://nostr-wot.com:444/download?theme=coracle', 'https://nostr-wot.com/other?theme=coracle', 'invalid']) {
      assert.equal(downloadTheme(url), null);
    }
  });
  it('opens onboarding carrying a unique download theme only on fresh installation', async () => {
    const opened: string[] = [];
    const deps = {
      read: async () => ({}),
      query: async () => [{ url: 'https://nostr-wot.com/download?theme=nostrudel&ref=x' }],
      url: (path: string) => `chrome-extension://test/${path}`,
      open: async (url: string) => { opened.push(url); },
    };
    await openInstalledWelcome('update', deps);
    assert.equal(opened.length, 0);
    await openInstalledWelcome('install', deps);
    assert.equal(opened[0], 'chrome-extension://test/src/entrypoints/onboarding/index.html?theme=nostrudel');
    for (const stored of [{ keyVault: {} }, { accounts: [{ id: 'watch-only' }] }]) {
      await openInstalledWelcome('install', { ...deps, read: async () => stored });
    }
    assert.equal(opened.length, 1);
  });
  it('does not guess between conflicting download tabs or override saved themes', async () => {
    const opened: string[] = [];
    const deps = {
      read: async () => ({}),
      query: async () => [{ url: 'https://nostr-wot.com/download?theme=coracle' }, { url: 'https://nostr-wot.com/download?theme=nostrich' }],
      url: (path: string) => path,
      open: async (url: string) => { opened.push(url); },
    };
    await openInstalledWelcome('install', deps);
    await openInstalledWelcome('install', { ...deps, read: async () => ({ appearanceTheme: 'dark' }) });
    await openInstalledWelcome('install', { ...deps, query: async () => { throw new Error('denied'); } });
    assert.deepEqual(opened, Array(3).fill('src/entrypoints/onboarding/index.html'));
  });
});
