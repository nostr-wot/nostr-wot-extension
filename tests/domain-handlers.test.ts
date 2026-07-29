import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import browserMock, { resetMockStorage } from './helpers/browser-mock.ts';
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
  handlers,
} from '../lib/bg/domain-handlers.ts';

describe('broadcastAccountChanged -- only notifies connected origins', () => {
  beforeEach(() => resetMockStorage());

  it('sends the pubkey only to allowed tabs, never to unconnected/restricted ones', async () => {
    await addAllowedDomain('allowed.com');
    const sent: Array<{ id: number; pubkey: string }> = [];
    const origQuery = browserMock.tabs.query;
    const origSend = (browserMock.tabs as Record<string, unknown>).sendMessage;
    browserMock.tabs.query = (() => Promise.resolve([
      { id: 1, url: 'https://allowed.com/feed' },
      { id: 2, url: 'https://evil.com/' },          // never connected — must be skipped
      { id: 3, url: 'chrome://extensions' },        // restricted — must be skipped
    ])) as typeof browserMock.tabs.query;
    (browserMock.tabs as Record<string, unknown>).sendMessage =
      (id: number, msg: { pubkey: string }) => { sent.push({ id, pubkey: msg.pubkey }); return Promise.resolve(); };
    try {
      await broadcastAccountChanged('deadbeefpubkey');
    } finally {
      browserMock.tabs.query = origQuery;
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
    assert.strictEqual(domains.filter(d => d === 'evil.com').length, 1);
  });

  it('returns all dismissed domains', async () => {
    await addDismissedDomain('a.com');
    await addDismissedDomain('b.com');
    const domains = await getDismissedDomains();
    assert.deepStrictEqual(domains.sort(), ['a.com', 'b.com']);
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
