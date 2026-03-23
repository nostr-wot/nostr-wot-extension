import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resetMockStorage } from './helpers/browser-mock.ts';
import {
  getAllowedDomains,
  isDomainAllowed,
  addAllowedDomain,
  removeAllowedDomain,
  getDismissedDomains,
  isDomainDismissed,
  addDismissedDomain,
} from '../lib/bg/domain-handlers.ts';

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
