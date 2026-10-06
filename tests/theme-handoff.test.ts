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
  it('only opens on first install without a vault or saved accounts', async () => {
    let popups = 0;
    const saved: string[] = [];
    const deps = {
      read: async () => ({}),
      query: async () => [{ url: 'https://nostr-wot.com/download?theme=nostrudel&ref=x' }],
      saveTheme: async (theme: string) => { saved.push(theme); },
      openPopup: async () => { popups++; },
    };
    await openInstalledWelcome('update', deps);
    assert.equal(popups, 0);
    await openInstalledWelcome('install', deps);
    assert.equal(popups, 1);
    assert.deepEqual(saved, ['nostrudel']);
    for (const stored of [{ keyVault: {} }, { accounts: [{ id: 'watch-only' }] }]) {
      await openInstalledWelcome('install', { ...deps, read: async () => stored });
    }
    assert.equal(popups, 1);
  });
  it('does not guess between conflicting download tabs or override saved themes', async () => {
    let popups = 0;
    const deps = {
      read: async () => ({}),
      query: async () => [{ url: 'https://nostr-wot.com/download?theme=coracle' }, { url: 'https://nostr-wot.com/download?theme=nostrich' }],
      saveTheme: async () => { assert.fail('must not write a theme'); },
      openPopup: async () => { popups++; },
    };
    await openInstalledWelcome('install', deps);
    await openInstalledWelcome('install', { ...deps, read: async () => ({ appearanceTheme: 'dark' }) });
    await openInstalledWelcome('install', { ...deps, query: async () => { throw new Error('denied'); } });
    assert.equal(popups, 3);
  });
  it('persists the theme before opening the native popup', async () => {
    const events: string[] = [];
    await openInstalledWelcome('install', {
      read: async () => ({}),
      query: async () => [{ url: 'https://nostr-wot.com/download?theme=coracle' }],
      saveTheme: async theme => { await Promise.resolve(); events.push(`saved:${theme}`); },
      openPopup: async () => { assert.deepEqual(events, ['saved:coracle']); events.push('popup'); },
    });
    assert.deepEqual(events, ['saved:coracle', 'popup']);
  });
  it('keeps the theme when automatic popup opening is refused, without opening a page or retrying', async () => {
    let saved: string | undefined;
    let attempts = 0;
    await openInstalledWelcome('install', {
      read: async () => ({}),
      query: async () => [{ url: 'https://nostr-wot.com/download?theme=yakihonne' }],
      saveTheme: async theme => { saved = theme; },
      openPopup: async () => { attempts++; throw new Error('user gesture required'); },
      // Guards against reintroducing the old setup-tab fallback.
      ...{ open: async () => { assert.fail('no separate page'); }, url: () => { assert.fail('no setup URL'); } },
    });
    assert.equal(saved, 'yakihonne');
    assert.equal(attempts, 1);
  });
  it('still attempts the popup if theme storage is unavailable', async () => {
    let popups = 0;
    await openInstalledWelcome('install', {
      read: async () => ({}),
      query: async () => [{ url: 'https://nostr-wot.com/download?theme=coracle' }],
      saveTheme: async () => { throw new Error('storage unavailable'); },
      openPopup: async () => { popups++; },
    });
    assert.equal(popups, 1);
  });
});

it('popup mounts even if preference initialization never responds and refreshes when it recovers', async () => {
  const { startPopup } = await import('../src/services/appearance/popupStartup.ts');
  let resolve!: () => void;
  let rendered = 0;
  const stalled = new Promise<void>(done => { resolve = done; });
  startPopup(() => stalled, () => { rendered++; }, 10);
  await new Promise(done => setTimeout(done, 25));
  assert.equal(rendered, 1);
  resolve();
  await new Promise(done => setTimeout(done, 0));
  assert.equal(rendered, 2);
});
it('popup mounts once after failed or successful preference initialization', async () => {
  const { startPopup } = await import('../src/services/appearance/popupStartup.ts');
  for (const initialize of [async () => {}, async () => { throw new Error('storage unavailable'); }]) {
    let rendered = 0;
    startPopup(initialize, () => { rendered++; }, 10);
    await new Promise(done => setTimeout(done, 25));
    assert.equal(rendered, 1);
  }
});
