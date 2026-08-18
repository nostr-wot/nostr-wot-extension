import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import browserMock, { resetMockStorage } from './helpers/browser-mock.ts';
import * as signerPermissions from '../lib/permissions.ts';
import {
  getAllowedDomains,
  isDomainAllowed,
  addAllowedDomain,
  removeAllowedDomain,
  getDismissedDomains,
  isDomainDismissed,
  addDismissedDomain,
  getWeblnAllowedDomains,
  isWeblnAllowed,
  addWeblnAllowedDomain,
  removeWeblnAllowedDomain,
  broadcastAccountChanged,
  waitForDomainAllowed,
  waitForConnectDecision,
  rememberTabOrigin,
  forgetTabOrigin,
  __getTabOrigins,
  releaseLegacyHostGrants,
  removeDismissedDomain,
  getDismissDuration,
  setDismissDuration,
  connectDomain,
  handlers,
} from '../lib/bg/domain-handlers.ts';

describe('broadcastAccountChanged -- only notifies connected origins', () => {
  beforeEach(() => { resetMockStorage(); __getTabOrigins().clear(); });

  it('sends the pubkey only to allowed tabs, never to unconnected/restricted ones', async () => {
    await addAllowedDomain('allowed.com');
    const sent: Array<{ id: number; pubkey: string }> = [];
    const origSend = (browserMock.tabs as Record<string, unknown>).sendMessage;
    // Tabs are known from the ports their content scripts opened, not from tab.url —
    // which the browser strips from us without an explicit host permission.
    rememberTabOrigin(1, 'allowed.com');
    rememberTabOrigin(2, 'evil.com');   // never connected — must be skipped
    (browserMock.tabs as Record<string, unknown>).sendMessage =
      (id: number, msg: { pubkey: string }) => { sent.push({ id, pubkey: msg.pubkey }); return Promise.resolve(); };
    try {
      await broadcastAccountChanged('deadbeefpubkey');
    } finally {
      (browserMock.tabs as Record<string, unknown>).sendMessage = origSend;
    }
    assert.deepStrictEqual(sent.map(s => s.id), [1]);
    assert.strictEqual(sent[0].pubkey, 'deadbeefpubkey');
  });
});


describe('dismissed domains -- CRUD', () => {
  beforeEach(() => resetMockStorage());

  it('returns empty array when no dismissed domains', async () => {
    const domains = await getDismissedDomains();
    assert.deepStrictEqual(domains, []);
  });

  it('adds a dismissed domain', async () => {
    await addDismissedDomain('evil.com');
    assert.strictEqual(await isDomainDismissed('evil.com'), true);
    assert.strictEqual(await isDomainDismissed('good.com'), false);
  });

  it('does not duplicate dismissed domains', async () => {
    await addDismissedDomain('evil.com');
    await addDismissedDomain('evil.com');
    const domains = await getDismissedDomains();
    assert.strictEqual(domains.filter(d => d.domain === 'evil.com').length, 1);
  });

  it('returns all dismissed domains', async () => {
    await addDismissedDomain('a.com');
    await addDismissedDomain('b.com');
    const domains = await getDismissedDomains();
    assert.deepStrictEqual(domains.map(d => d.domain).sort(), ['a.com', 'b.com']);
  });
});

describe('dismissed domains -- interaction with allowed domains', () => {
  beforeEach(() => resetMockStorage());

  it('addAllowedDomain clears dismissal for the same domain', async () => {
    await addDismissedDomain('example.com');
    assert.strictEqual(await isDomainDismissed('example.com'), true);

    await addAllowedDomain('example.com');
    assert.strictEqual(await isDomainAllowed('example.com'), true);
    assert.strictEqual(await isDomainDismissed('example.com'), false);
  });

  it('addAllowedDomain does not affect other dismissed domains', async () => {
    await addDismissedDomain('a.com');
    await addDismissedDomain('b.com');

    await addAllowedDomain('a.com');
    assert.strictEqual(await isDomainDismissed('a.com'), false);
    assert.strictEqual(await isDomainDismissed('b.com'), true);
  });

  it('allowed and dismissed domains are independent storage', async () => {
    await addAllowedDomain('good.com');
    await addDismissedDomain('bad.com');

    assert.strictEqual(await isDomainAllowed('good.com'), true);
    assert.strictEqual(await isDomainDismissed('good.com'), false);
    assert.strictEqual(await isDomainAllowed('bad.com'), false);
    assert.strictEqual(await isDomainDismissed('bad.com'), true);
  });
});

// The connect gate: what happens while the "Connect this site" card is up.
// Dismissal used to be unreachable from the UI, so closing the card recorded
// nothing and the site's next request re-opened the popup.

describe('connect gate -- waiting for the user decision', () => {
  beforeEach(() => resetMockStorage());

  it('addDismissedDomain is reachable as an RPC handler', () => {
    assert.ok(handlers.has('addDismissedDomain'), 'the popup must be able to record a dismissal');
  });

  it('waitForDomainAllowed resolves true when the user connects', async () => {
    const wait = waitForDomainAllowed('site.com');
    await addAllowedDomain('site.com');
    assert.strictEqual(await wait, true);
  });

  it('waitForDomainAllowed resolves false as soon as the user dismisses', async () => {
    const wait = waitForDomainAllowed('site.com');
    await addDismissedDomain('site.com');
    assert.strictEqual(await wait, false, 'must not hold the request open for the full timeout');
  });

  it('waitForDomainAllowed ignores decisions about other domains', async () => {
    const wait = waitForDomainAllowed('site.com');
    await addDismissedDomain('other.com');
    await addAllowedDomain('other.com');

    const settled = await Promise.race([
      wait.then(v => ({ done: true, v })),
      new Promise<{ done: boolean }>(r => { const t = setTimeout(() => r({ done: false }), 100); t.unref?.(); }),
    ]);
    assert.strictEqual(settled.done, false, 'another domain must not settle this wait');

    // Settle it so the pending timer does not outlive the test
    await addDismissedDomain('site.com');
    assert.strictEqual(await wait, false);
  });

  it('concurrent requests from one origin share a single connect gate', async () => {
    let popupOpens = 0;
    const origQuery = browserMock.tabs.query;
    const origOpen = (browserMock.action as Record<string, unknown>).openPopup;
    browserMock.tabs.query = (() => Promise.resolve([{ id: 1, url: 'https://site.com/feed' }])) as typeof browserMock.tabs.query;
    (browserMock.action as Record<string, unknown>).openPopup = () => { popupOpens++; return Promise.resolve(); };

    try {
      const waits = [
        waitForConnectDecision('site.com'),
        waitForConnectDecision('site.com'),
        waitForConnectDecision('site.com'),
      ];
      await new Promise<void>(r => { const t = setTimeout(r, 50); t.unref?.(); });
      await addAllowedDomain('site.com');

      assert.deepStrictEqual(await Promise.all(waits), [true, true, true]);
      assert.strictEqual(popupOpens, 1, 'three concurrent calls must open the popup once');
    } finally {
      browserMock.tabs.query = origQuery;
      (browserMock.action as Record<string, unknown>).openPopup = origOpen;
    }
  });

  it('a new request after the gate settles opens the popup again', async () => {
    let popupOpens = 0;
    const origQuery = browserMock.tabs.query;
    const origOpen = (browserMock.action as Record<string, unknown>).openPopup;
    browserMock.tabs.query = (() => Promise.resolve([{ id: 1, url: 'https://site.com/feed' }])) as typeof browserMock.tabs.query;
    (browserMock.action as Record<string, unknown>).openPopup = () => { popupOpens++; return Promise.resolve(); };

    try {
      const first = waitForConnectDecision('site.com');
      await new Promise<void>(r => { const t = setTimeout(r, 50); t.unref?.(); });
      await addDismissedDomain('site.com');
      assert.strictEqual(await first, false);

      // Gate released — a later call is a fresh decision, not a stale cached one
      const second = waitForConnectDecision('site.com');
      await new Promise<void>(r => { const t = setTimeout(r, 50); t.unref?.(); });
      await addAllowedDomain('site.com');
      assert.strictEqual(await second, true);
      assert.strictEqual(popupOpens, 2);
    } finally {
      browserMock.tabs.query = origQuery;
      (browserMock.action as Record<string, unknown>).openPopup = origOpen;
    }
  });
});

describe('allowed domains -- basic CRUD', () => {
  beforeEach(() => resetMockStorage());

  it('returns empty array when no allowed domains', async () => {
    const domains = await getAllowedDomains();
    assert.deepStrictEqual(domains, []);
  });

  it('adds and checks allowed domains', async () => {
    await addAllowedDomain('nostr.com');
    assert.strictEqual(await isDomainAllowed('nostr.com'), true);
    assert.strictEqual(await isDomainAllowed('other.com'), false);
  });

  it('removes allowed domains', async () => {
    await addAllowedDomain('nostr.com');
    await removeAllowedDomain('nostr.com');
    assert.strictEqual(await isDomainAllowed('nostr.com'), false);
  });
});

describe('WebLN allowed domains -- basic CRUD', () => {
  beforeEach(() => resetMockStorage());

  it('returns empty array when no WebLN domains', async () => {
    const domains = await getWeblnAllowedDomains();
    assert.deepStrictEqual(domains, []);
  });

  it('adds and checks WebLN domains', async () => {
    await addWeblnAllowedDomain('zap.store');
    assert.strictEqual(await isWeblnAllowed('zap.store'), true);
    assert.strictEqual(await isWeblnAllowed('other.com'), false);
  });

  it('does not duplicate WebLN domains', async () => {
    await addWeblnAllowedDomain('zap.store');
    await addWeblnAllowedDomain('zap.store');
    const domains = await getWeblnAllowedDomains();
    assert.strictEqual(domains.filter(d => d === 'zap.store').length, 1);
  });

  it('removes WebLN domains', async () => {
    await addWeblnAllowedDomain('zap.store');
    await removeWeblnAllowedDomain('zap.store');
    assert.strictEqual(await isWeblnAllowed('zap.store'), false);
  });
});

describe('WebLN allowed domains -- interaction with allowed domains', () => {
  beforeEach(() => resetMockStorage());

  it('WebLN consent is separate storage from NIP-07 connect', async () => {
    await addAllowedDomain('nostr.com');
    assert.strictEqual(await isDomainAllowed('nostr.com'), true);
    assert.strictEqual(await isWeblnAllowed('nostr.com'), false,
      'a NIP-07 connect must not grant WebLN');
  });

  it('removeAllowedDomain also revokes WebLN consent (disconnect)', async () => {
    await addAllowedDomain('zap.store');
    await addWeblnAllowedDomain('zap.store');
    await removeAllowedDomain('zap.store');
    assert.strictEqual(await isDomainAllowed('zap.store'), false);
    assert.strictEqual(await isWeblnAllowed('zap.store'), false);
  });

  it('removeAllowedDomain leaves other WebLN domains intact', async () => {
    await addWeblnAllowedDomain('a.com');
    await addWeblnAllowedDomain('b.com');
    await removeAllowedDomain('a.com');
    assert.strictEqual(await isWeblnAllowed('a.com'), false);
    assert.strictEqual(await isWeblnAllowed('b.com'), true);
  });
});

// ── The connect gate must not miss a decision that already landed ──

describe('waitForDomainAllowed: decisions made before the listener attaches', () => {
  beforeEach(() => {
    resetMockStorage();
  });

  it('resolves true immediately when the domain is already allowed', async () => {
    // The window is small but real: the caller checks isDomainAllowed, the user connects,
    // and only then does the wait attach its listener. Reacting only to CHANGES meant that
    // decision was never seen and the site's request hung for the full timeout.
    await addAllowedDomain('already.com');

    const result = await Promise.race([
      waitForDomainAllowed('already.com'),
      new Promise<string>(r => setTimeout(() => r('hung'), 200)),
    ]);
    assert.strictEqual(result, true, 'must not wait for a change that already happened');
  });

});

// ── Disconnect must be durable ──

describe('removeAllowedDomain clears everything that could resurrect the site', () => {
  beforeEach(() => resetMockStorage());

  it('clears the signer permissions along with the allowlist entry', async () => {
    await addAllowedDomain('shop.example');
    await signerPermissions.saveDirect('shop.example', 'signEvent:1', 'allow');
    assert.notDeepStrictEqual(await signerPermissions.getForDomain('shop.example'), {});

    await removeAllowedDomain('shop.example');

    assert.strictEqual(await isDomainAllowed('shop.example'), false);
    assert.deepStrictEqual(await signerPermissions.getForDomain('shop.example'), {},
      'leftover rules are what used to re-add the site on the next popup render');
  });

  it('clears an explicit deny too, so a refusal cannot linger as evidence of a connection', async () => {
    await addAllowedDomain('bad.example');
    await signerPermissions.saveDirect('bad.example', 'signEvent:1', 'deny');
    await removeAllowedDomain('bad.example');
    assert.deepStrictEqual(await signerPermissions.getForDomain('bad.example'), {});
  });

  it('leaves other domains untouched', async () => {
    await addAllowedDomain('a.example');
    await addAllowedDomain('b.example');
    await signerPermissions.saveDirect('a.example', 'signEvent:1', 'allow');
    await signerPermissions.saveDirect('b.example', 'signEvent:1', 'allow');

    await removeAllowedDomain('a.example');

    assert.deepStrictEqual(await signerPermissions.getForDomain('a.example'), {});
    assert.deepStrictEqual(await signerPermissions.getForDomain('b.example'), { 'signEvent:1': 'allow' });
    assert.strictEqual(await isDomainAllowed('b.example'), true);
  });
});

// ── Account-change broadcast must not depend on tab.url ──
//
// tabs.query() strips url/title/favIconUrl unless the extension holds "tabs" or an explicit
// host permission for that tab; content-script `matches` do not count. With no per-site
// grants there is no url to filter on, so the old implementation skipped every tab and
// connected sites silently stopped hearing about account switches. These tests therefore
// give the mock tabs with NO url — the shape the browser really hands us — which the
// previous test mock could not express and so could never catch.

describe('broadcastAccountChanged uses the port registry, not tab.url', () => {
  let sent: Array<{ tabId: number; msg: any }>;
  let origSend: any;

  beforeEach(() => {
    resetMockStorage();
    __getTabOrigins().clear();
    sent = [];
    origSend = (browserMock.tabs as any).sendMessage;
    (browserMock.tabs as any).sendMessage = (tabId: number, msg: any) => {
      sent.push({ tabId, msg });
      return Promise.resolve();
    };
    (browserMock.tabs as any).query = () =>
      Promise.resolve([{ id: 1 }, { id: 2 }, { id: 3 }]); // no url — as the browser gives it
  });

  it('notifies a connected site whose tab URL we cannot read', async () => {
    rememberTabOrigin(1, 'connected.example');
    await addAllowedDomain('connected.example');

    await broadcastAccountChanged('pubkey-hex');

    assert.deepStrictEqual(sent.map(s => s.tabId), [1]);
    assert.strictEqual(sent[0].msg.type, 'NOSTR_ACCOUNT_CHANGED');
    assert.strictEqual(sent[0].msg.pubkey, 'pubkey-hex');
  });

  it('never notifies a site the user has not connected', async () => {
    rememberTabOrigin(1, 'connected.example');
    rememberTabOrigin(2, 'stranger.example');
    await addAllowedDomain('connected.example');

    await broadcastAccountChanged('pubkey-hex');

    assert.deepStrictEqual(sent.map(s => s.tabId), [1],
      'an unconnected tab must never learn the active pubkey');
  });

  it('respects the per-site identity toggle', async () => {
    rememberTabOrigin(1, 'connected.example');
    await addAllowedDomain('connected.example');
    await handlers.get('setIdentityDisabled')!({ domain: 'connected.example', disabled: true });

    await broadcastAccountChanged('pubkey-hex');

    assert.deepStrictEqual(sent, [], 'identity disabled means no broadcast');
  });

  it('forgets a tab when its port disconnects', async () => {
    rememberTabOrigin(1, 'connected.example');
    await addAllowedDomain('connected.example');
    forgetTabOrigin(1);

    await broadcastAccountChanged('pubkey-hex');

    assert.deepStrictEqual(sent, []);
  });

  it('notifies every connected tab of the same origin', async () => {
    rememberTabOrigin(1, 'connected.example');
    rememberTabOrigin(2, 'connected.example');
    await addAllowedDomain('connected.example');

    await broadcastAccountChanged('pubkey-hex');

    assert.deepStrictEqual(sent.map(s => s.tabId).sort(), [1, 2]);
  });

  afterEach(() => {
    (browserMock.tabs as any).sendMessage = origSend;
  });
});

// ── Releasing the host grants older versions asked for ──

describe('releaseLegacyHostGrants', () => {
  beforeEach(() => {
    resetMockStorage();
    (browserMock as any).permissions._granted = { origins: [], permissions: [] };
  });

  it('hands back per-site grants left over from earlier versions', async () => {
    (browserMock as any).permissions._granted.origins = ['*://a.example/*', '*://b.example/*'];

    const released = await releaseLegacyHostGrants();

    assert.deepStrictEqual(released.sort(), ['*://a.example/*', '*://b.example/*']);
    assert.deepStrictEqual((browserMock as any).permissions._granted.origins, [],
      'Chrome should stop listing those sites as readable');
  });

  it('leaves a broad grant the user made deliberately alone', async () => {
    // <all_urls> is not a per-site connect leftover; the user chose it in the browser UI
    // and it is not ours to revoke.
    (browserMock as any).permissions._granted.origins = ['<all_urls>'];
    assert.deepStrictEqual(await releaseLegacyHostGrants(), []);
    assert.deepStrictEqual((browserMock as any).permissions._granted.origins, ['<all_urls>']);
  });

  it('is a no-op when nothing was ever granted', async () => {
    assert.deepStrictEqual(await releaseLegacyHostGrants(), []);
  });
});

// ── "Not now" has a lifetime the user chooses, and is always undoable ──

describe('dismissal lifetimes', () => {
  beforeEach(() => resetMockStorage());

  it('expires after the configured duration', async () => {
    await setDismissDuration(86_400_000); // 1 day
    await addDismissedDomain('nag.example');
    assert.strictEqual(await isDomainDismissed('nag.example'), true);

    // Backdate the entry past its expiry.
    const store = (await browserMock.storage.local.get('dismissedDomains')) as any;
    store.dismissedDomains['nag.example'].until = Date.now() - 1000;
    await browserMock.storage.local.set({ dismissedDomains: store.dismissedDomains });

    assert.strictEqual(await isDomainDismissed('nag.example'), false,
      'a declined site must be able to ask again once the duration is up');
    const left = (await browserMock.storage.local.get('dismissedDomains')) as any;
    assert.strictEqual(left.dismissedDomains['nag.example'], undefined, 'and the entry is swept');
  });

  it('"Never" does not expire', async () => {
    await addDismissedDomain('never.example', true);
    const store = (await browserMock.storage.local.get('dismissedDomains')) as any;
    assert.strictEqual(store.dismissedDomains['never.example'].until, 'never');
    assert.strictEqual(await isDomainDismissed('never.example'), true);
  });

  it('"Never" is still listed and still undoable — permanence must be visible', async () => {
    await addDismissedDomain('never.example', true);
    assert.deepStrictEqual(
      (await getDismissedDomains()).map(d => ({ domain: d.domain, until: d.until })),
      [{ domain: 'never.example', until: 'never' }],
    );
    await removeDismissedDomain('never.example');
    assert.strictEqual(await isDomainDismissed('never.example'), false);
  });

  it('session dismissals live in session storage and vanish with it', async () => {
    await setDismissDuration(0); // until the browser restarts
    await addDismissedDomain('today.example');
    assert.strictEqual(await isDomainDismissed('today.example'), true);
    assert.deepStrictEqual((await getDismissedDomains()).map(d => d.until), ['session']);

    // A browser restart clears storage.session.
    await browserMock.storage.session.remove('sessionDismissedDomains');
    assert.strictEqual(await isDomainDismissed('today.example'), false);
  });

  it('connecting a site clears any dismissal, whatever its lifetime', async () => {
    await addDismissedDomain('changed.example', true);
    await connectDomain('changed.example');
    assert.strictEqual(await isDomainDismissed('changed.example'), false);
    assert.strictEqual(await isDomainAllowed('changed.example'), true);
  });

  it('migrates the legacy string[] shape and starts its clock now', async () => {
    // Entries written by an older build carry no date; expiring them instantly would
    // resurrect a site the user silenced yesterday.
    await browserMock.storage.local.set({ dismissedDomains: ['old.example'] });
    assert.strictEqual(await isDomainDismissed('old.example'), true);
    const store = (await browserMock.storage.local.get('dismissedDomains')) as any;
    assert.ok(typeof store.dismissedDomains['old.example'].until === 'number',
      'the legacy entry now has an expiry instead of being permanent');
  });

  it('rejects a duration that is not on the menu', async () => {
    await assert.rejects(() => setDismissDuration(1234), /Unsupported/);
  });

  it('defaults to seven days', async () => {
    assert.strictEqual(await getDismissDuration(), 604_800_000);
  });
});
