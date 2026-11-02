import { beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import browser, { resetMockStorage } from './helpers/browser-mock';
import { validateTemplateRules, recommendedRules, siteTemplate, TEMPLATE_SITES, TEMPLATE_PRESETS } from '../src/domain/permissions/templates';
import { listTemplates, saveTemplate, deleteTemplate } from '../src/services/permissions/templates';
import * as permissions from '../src/services/permissions/permissions';
import { removeAllowedDomain, isDomainAllowed } from '../src/services/background/domain-handlers';

beforeEach(async () => {
  resetMockStorage(); permissions.invalidateCache();
  await browser.storage.local.set({ activeAccountId: 'a', accounts: [{ id: 'a', type: 'nsec' }], signerRulesInheritance: true, signerGlobalRulesVersion: 1 });
});
it('recognizes ten exact sites, not subdomains, lookalikes or HTTP', () => {
  assert.equal(TEMPLATE_SITES.length, 10);
  assert.equal(siteTemplate('https://nostrwot.com')?.name, 'Nostr WoT');
  for (const origin of ['http://primal.net', 'https://primal.net.evil.com', 'https://evilprimal.net', 'https://www.primal.net']) assert.equal(siteTemplate(origin), undefined);
  for (const preset of TEMPLATE_PRESETS) { assert.deepEqual(validateTemplateRules(preset.rules), preset.rules); assert.equal('getPublicKey' in preset.rules, false); assert.equal('webln_sendPayment' in preset.rules, false); assert.equal('*' in preset.rules, false); }
  assert.equal(recommendedRules('https://primal.net')['signEvent:7'], 'allow');
});
it('rejects wildcard, payment, identity and malformed template permissions', () => {
  for (const key of ['*', 'signEvent', '__proto__', 'constructor', 'getPublicKey', 'webln_sendPayment', 'signEvent:65536', 'signEvent:04', 'signEvent:4']) assert.throws(() => validateTemplateRules(JSON.parse(`{"${key}":"allow"}`)));
  assert.throws(() => validateTemplateRules({ readMessages: 'yes' }));
});
it('custom save/update/delete never changes applied site rules', async () => {
  const template = { id: 'custom-one', name: 'My social', rules: { 'signEvent:1': 'allow' as const } };
  await saveTemplate(template);
  await permissions.connectWithTemplate('https://example.com', 'a', template.rules);
  await saveTemplate({ ...template, rules: { 'signEvent:1': 'deny' } });
  assert.equal((await listTemplates()).length, 1);
  assert.equal(await permissions.check('https://example.com', 'signEvent', 1, 'a'), 'allow');
  await deleteTemplate(template.id); assert.deepEqual(await listTemplates(), []);
  assert.equal(await permissions.check('https://example.com', 'signEvent', 1, 'a'), 'allow');
});
it('apply connects only the exact site and account, grants identity, and disconnect revokes it', async () => {
  await permissions.connectWithTemplate('https://primal.net', 'a', { 'signEvent:1': 'allow' });
  assert.equal(await isDomainAllowed('https://primal.net'), true);
  assert.equal(await isDomainAllowed('http://primal.net'), false);
  assert.equal(await permissions.check('https://primal.net', 'getPublicKey', undefined, 'a'), 'allow');
  assert.equal(await permissions.check('https://primal.net', 'signEvent', 1, 'b'), 'ask');
  assert.equal(await permissions.check('https://primal.net', 'webln_sendPayment', undefined, 'a'), 'ask');
  await removeAllowedDomain('https://primal.net');
  assert.equal(await isDomainAllowed('https://primal.net'), false);
  assert.equal(await permissions.check('https://primal.net', 'signEvent', 1, 'a'), 'ask');
});
it('skip adds no signing rules, preserving inherited defaults', async () => {
  await permissions.saveDirect('_global', 'signEvent:7', 'allow', '_default');
  await permissions.connectWithTemplate('https://example.com', 'a', {});
  assert.equal(await permissions.check('https://example.com', 'signEvent', 7, 'a'), 'allow');
  assert.equal(await permissions.check('https://example.com', 'signEvent', 1, 'a'), 'ask');
});
it('denials, stale accounts, invalid origin and readonly accounts fail without connecting', async () => {
  await permissions.saveDirect('https://example.com', 'signEvent:1', 'deny', 'a');
  await assert.rejects(permissions.connectWithTemplate('https://example.com', 'a', { 'signEvent:1': 'allow' }), /Deny/);
  await assert.rejects(permissions.connectWithTemplate('https://example.com', 'b', {}), /Account changed/);
  await assert.rejects(permissions.connectWithTemplate('https://example.com/path', 'a', {}), /origin/);
  await browser.storage.local.set({ accounts: [{ id: 'a', type: 'npub', readOnly: true }] });
  await assert.rejects(permissions.connectWithTemplate('https://example.com', 'a', { sendMessages: 'allow' }), /Read-only/);
  assert.equal(await isDomainAllowed('https://example.com'), false);
});
it('a failed storage commit never connects or caches a partial grant', async context => {
  const write = browser.storage.local.set.bind(browser.storage.local);
  context.mock.method(browser.storage.local, 'set', async (values: Record<string, unknown>) => {
    if ('allowedDomains' in values) throw new Error('Storage unavailable');
    return write(values);
  });
  await assert.rejects(permissions.connectWithTemplate('https://example.com', 'a', { 'signEvent:1':'allow' }), /Storage unavailable/);
  assert.equal(await isDomainAllowed('https://example.com'), false);
  assert.equal(await permissions.check('https://example.com', 'signEvent', 1, 'a'), 'ask');
});
it('Nostr WoT recommends the playground read capabilities without signing or payments', () => {
  assert.deepEqual(recommendedRules('https://nostrwot.com'), { wot_getStatus:'allow', wot_getFollows:'allow', wot_getDistanceBatch:'allow' });
  assert.deepEqual(validateTemplateRules(recommendedRules('https://nostrwot.com')), recommendedRules('https://nostrwot.com'));
});
it('combining templates keeps the most restrictive decision regardless of order', async () => {
  const { combineTemplateRules } = await import('../src/domain/permissions/templates');
  const templates = [{rules:{readMessages:'allow' as const}}, {rules:{readMessages:'deny' as const}}];
  assert.equal(combineTemplateRules(templates).readMessages, 'deny');
  assert.equal(combineTemplateRules(templates.reverse()).readMessages, 'deny');
});
it('applying a template cannot restore another site disconnected concurrently', async context => {
  await browser.storage.local.set({ allowedDomains: ['https://revoked.test'] });
  const read = browser.storage.local.get.bind(browser.storage.local);
  let release!: () => void;
  let reached!: () => void;
  const paused = new Promise<void>(resolve => { reached = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  context.mock.method(browser.storage.local, 'get', async (key: any) => {
    if (key === 'activeAccountId') { reached(); await resume; }
    return read(key);
  });
  const connecting = permissions.connectWithTemplate('https://new.test', 'a', {});
  await paused;
  const disconnecting = removeAllowedDomain('https://revoked.test');
  await new Promise<void>(resolve => setImmediate(resolve));
  release();
  await Promise.all([connecting, disconnecting]);
  assert.equal(await isDomainAllowed('https://revoked.test'), false);
  assert.equal(await isDomainAllowed('https://new.test'), true);
});

it('Nostr Connect connects without writing permissions and refuses local templates', async () => {
  await browser.storage.local.set({ accounts: [{ id: 'a', type: 'nip46' }] });
  await assert.rejects(permissions.connectWithTemplate('https://example.com', 'a', { 'signEvent:1': 'allow' }), /remote signer/);
  assert.equal(await isDomainAllowed('https://example.com'), false);
  await permissions.connectWithTemplate('https://example.com', 'a', {});
  assert.equal(await isDomainAllowed('https://example.com'), true);
  assert.equal(await permissions.check('https://example.com', 'getPublicKey', undefined, 'a'), 'ask');
  assert.equal(await permissions.check('https://example.com', 'signEvent', 1, 'a'), 'ask');
});
