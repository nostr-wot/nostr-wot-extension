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
} from '../lib/bg/domain-handlers.ts';

describe('broadcastAccountChanged -- only notifies connected origins', () => {
  beforeEach(() => resetMockStorage());

  it('sends the pubkey only to allowed tabs, never to unconnected/restricted ones', async () => {
    await addAllowedDomain('allowed.com');
    const sent: Array<{ id: number; pubkey: string }> = [];
    const origQuery = browserMock.tabs.query;
    const origSend = (browserMock.tabs as Record<string, unknown>).sendMessage;
    browserMock.tabs.query = () => Promise.resolve([
      { id: 1, url: 'https://allowed.com/feed' },
      { id: 2, url: 'https://evil.com/' },          // never connected — must be skipped
      { id: 3, url: 'chrome://extensions' },        // restricted — must be skipped
    ]);
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
