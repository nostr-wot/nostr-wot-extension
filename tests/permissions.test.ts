import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resetMockStorage } from './helpers/browser-mock.ts';
import * as permissions from '../src/services/permissions/permissions.ts';

describe('permissions -- check cascade', () => {
  beforeEach(() => resetMockStorage());

  it('returns "ask" when no permissions exist', async () => {
    const result: string = await permissions.check('example.com', 'signEvent', 1);
    assert.strictEqual(result, 'ask');
  });

  it('returns kind-specific permission when no other level denies', async () => {
    await permissions.save('example.com', 'signEvent', 1, 'allow');
    await permissions.save('example.com', 'signEvent', 7, 'deny');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1), 'allow');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 7), 'deny');
    // Kind with no entry falls through to ask
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 0), 'ask');
  });

  it('deny wins: kind-specific allow does NOT override method-level deny', async () => {
    await permissions.save('example.com', 'signEvent', 1, 'allow');
    await permissions.save('example.com', 'signEvent', null, 'deny');
    // Method-level deny short-circuits, even though signEvent:1 is allow
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1), 'deny');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 0), 'deny');
  });

  it('returns method-level when no kind match', async () => {
    await permissions.save('example.com', 'signEvent', null, 'allow');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 999), 'allow');
  });

  it('returns domain wildcard when no method match', async () => {
    await permissions.save('example.com', '*', null, 'deny');
    assert.strictEqual(await permissions.check('example.com', 'nip04Encrypt'), 'deny');
  });

  it('cascade order without deny: kind > method > wildcard > ask', async () => {
    // Wildcard allow applies when nothing more specific exists
    await permissions.save('example.com', '*', null, 'allow');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1), 'allow');

    // A more specific 'ask' cannot be stored (only allow/deny), so verify the
    // specific-wins order with allow values across levels: kind entry read first
    await permissions.save('example.com', 'signEvent', 1, 'allow');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1), 'allow');
  });

  it('deny wins at ANY consulted level (kind, method, or wildcard)', async () => {
    // Wildcard deny blocks a method-level allow
    await permissions.save('example.com', '*', null, 'deny');
    await permissions.save('example.com', 'signEvent', null, 'allow');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1), 'deny');

    // ...and blocks a kind-level allow too
    await permissions.save('example.com', 'signEvent', 1, 'allow');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1), 'deny');

    // Kind-level deny blocks even if method and wildcard allow
    await permissions.save('other.com', '*', null, 'allow');
    await permissions.save('other.com', 'signEvent', null, 'allow');
    await permissions.save('other.com', 'signEvent', 1, 'deny');
    assert.strictEqual(await permissions.check('other.com', 'signEvent', 1), 'deny');
    // Other kinds unaffected: method allow applies
    assert.strictEqual(await permissions.check('other.com', 'signEvent', 0), 'allow');
  });
});

describe('permissions -- isolation', () => {
  beforeEach(() => resetMockStorage());

  it('different domains are isolated', async () => {
    await permissions.save('site-a.com', 'signEvent', null, 'allow');
    await permissions.save('site-b.com', 'signEvent', null, 'deny');
    assert.strictEqual(await permissions.check('site-a.com', 'signEvent'), 'allow');
    assert.strictEqual(await permissions.check('site-b.com', 'signEvent'), 'deny');
    assert.strictEqual(await permissions.check('site-c.com', 'signEvent'), 'ask');
  });

  it('different methods are isolated', async () => {
    await permissions.save('example.com', 'signEvent', null, 'allow');
    assert.strictEqual(await permissions.check('example.com', 'signEvent'), 'allow');
    assert.strictEqual(await permissions.check('example.com', 'nip04Encrypt'), 'ask');
  });
});

describe('permissions -- save and clear', () => {
  beforeEach(() => resetMockStorage());

  it('save and retrieve', async () => {
    await permissions.save('example.com', 'signEvent', null, 'allow');
    const all: any = await permissions.getAll();
    assert.ok(all['example.com']);
    assert.strictEqual(all['example.com']['signEvent'], 'allow');
  });

  it('clear specific domain', async () => {
    await permissions.save('a.com', 'signEvent', null, 'allow');
    await permissions.save('b.com', 'signEvent', null, 'allow');
    await permissions.clear('a.com');
    assert.strictEqual(await permissions.check('a.com', 'signEvent'), 'ask');
    assert.strictEqual(await permissions.check('b.com', 'signEvent'), 'allow');
  });

  it('clear all permissions', async () => {
    await permissions.save('a.com', 'signEvent', null, 'allow');
    await permissions.save('b.com', 'signEvent', null, 'allow');
    await permissions.clear();
    assert.strictEqual(await permissions.check('a.com', 'signEvent'), 'ask');
    assert.strictEqual(await permissions.check('b.com', 'signEvent'), 'ask');
  });

  it('getForDomain returns domain permissions', async () => {
    await permissions.save('example.com', 'signEvent', null, 'allow');
    await permissions.save('example.com', 'nip04Encrypt', null, 'deny');
    const perms: any = await permissions.getForDomain('example.com');
    assert.strictEqual(perms['signEvent'], 'allow');
    // nip04Encrypt maps to logical key 'sendMessages'
    assert.strictEqual(perms['sendMessages'], 'deny');
  });

  it('getForDomain returns empty for unknown domain', async () => {
    const perms: any = await permissions.getForDomain('unknown.com');
    assert.deepStrictEqual(perms, {});
  });
});

describe('permissions -- per-account clear isolation', () => {
  beforeEach(() => resetMockStorage());

  it('clear in global-defaults mode only removes _default bucket', async () => {
    // Global defaults mode is the default (signerUseGlobalDefaults defaults to true)
    // Save permissions for _default bucket (global mode)
    await permissions.save('example.com', 'getPublicKey', null, 'allow');
    await permissions.save('example.com', 'signEvent', 1, 'allow');

    // Switch to per-account mode and save permissions for acct1
    await permissions.setUseGlobalDefaults(false);
    await permissions.save('example.com', 'signEvent', 1, 'allow', 'acct1');
    await permissions.save('example.com', 'nip04Encrypt', null, 'deny', 'acct1');

    // Switch back to global mode and clear for this domain
    await permissions.setUseGlobalDefaults(true);
    await permissions.clear('example.com');

    // Global defaults should be gone
    assert.strictEqual(await permissions.check('example.com', 'getPublicKey'), 'ask');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1), 'ask');

    // Per-account permissions for acct1 should still exist
    await permissions.setUseGlobalDefaults(false);
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1, 'acct1'), 'allow');
    assert.strictEqual(await permissions.check('example.com', 'nip04Encrypt', undefined, 'acct1'), 'deny');
  });

  it('clear in per-account mode only removes that account bucket', async () => {
    await permissions.setUseGlobalDefaults(false);

    // Save permissions for two different accounts
    await permissions.save('example.com', 'getPublicKey', null, 'allow', 'acct1');
    await permissions.save('example.com', 'signEvent', 1, 'allow', 'acct1');
    await permissions.save('example.com', 'getPublicKey', null, 'allow', 'acct2');
    await permissions.save('example.com', 'signEvent', 1, 'deny', 'acct2');

    // Clear acct1's permissions
    await permissions.clear('example.com', 'acct1');

    // acct1 should be cleared
    assert.strictEqual(await permissions.check('example.com', 'getPublicKey', undefined, 'acct1'), 'ask');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1, 'acct1'), 'ask');

    // acct2 should be untouched
    assert.strictEqual(await permissions.check('example.com', 'getPublicKey', undefined, 'acct2'), 'allow');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1, 'acct2'), 'deny');
  });

  it('clear preserves _default when clearing per-account bucket', async () => {
    // Save global defaults
    await permissions.save('example.com', 'getPublicKey', null, 'allow');

    // Save per-account permissions
    await permissions.setUseGlobalDefaults(false);
    await permissions.save('example.com', 'signEvent', 1, 'allow', 'acct1');

    // Clear acct1
    await permissions.clear('example.com', 'acct1');

    // _default should be preserved
    await permissions.setUseGlobalDefaults(true);
    assert.strictEqual(await permissions.check('example.com', 'getPublicKey'), 'allow');
  });

  it('domain entry removed only when all buckets are empty', async () => {
    await permissions.setUseGlobalDefaults(false);
    await permissions.save('example.com', 'signEvent', 1, 'allow', 'acct1');

    // Clear the only bucket — domain entry should be removed
    await permissions.clear('example.com', 'acct1');
    const raw = await permissions.getAllRaw();
    assert.strictEqual(raw['example.com'], undefined);
  });

  it('clear does nothing for nonexistent domain', async () => {
    // Should not throw
    await permissions.clear('nonexistent.com', 'acct1');
    const raw = await permissions.getAllRaw();
    assert.strictEqual(raw['nonexistent.com'], undefined);
  });
});

describe('permissions -- NIP-07 methods', () => {
  beforeEach(() => resetMockStorage());

  const methods: string[] = ['signEvent', 'nip04Encrypt', 'nip04Decrypt', 'nip44Encrypt', 'nip44Decrypt'];

  for (const method of methods) {
    it(`${method}: allow and deny work`, async () => {
      await permissions.save('test.com', method, null, 'allow');
      assert.strictEqual(await permissions.check('test.com', method), 'allow');

      await permissions.save('test.com', method, null, 'deny');
      assert.strictEqual(await permissions.check('test.com', method), 'deny');
    });
  }
});

describe('permissions -- encrypt/decrypt key mapping', () => {
  beforeEach(() => resetMockStorage());

  it('nip04 and nip44 encrypt share sendMessages key', async () => {
    await permissions.save('test.com', 'nip04Encrypt', null, 'allow');
    // nip44Encrypt should also be allowed (same logical key)
    assert.strictEqual(await permissions.check('test.com', 'nip44Encrypt'), 'allow');
  });

  it('nip04 and nip44 decrypt share readMessages key', async () => {
    await permissions.save('test.com', 'nip04Decrypt', null, 'allow');
    // nip44Decrypt should also be allowed (same logical key)
    assert.strictEqual(await permissions.check('test.com', 'nip44Decrypt'), 'allow');
  });

  it('permissionKey maps encrypt methods to sendMessages', () => {
    assert.strictEqual(permissions.permissionKey('nip04Encrypt'), 'sendMessages');
    assert.strictEqual(permissions.permissionKey('nip44Encrypt'), 'sendMessages');
  });

  it('permissionKey maps decrypt methods to readMessages', () => {
    assert.strictEqual(permissions.permissionKey('nip04Decrypt'), 'readMessages');
    assert.strictEqual(permissions.permissionKey('nip44Decrypt'), 'readMessages');
  });

  it('encrypt/decrypt permissions survive migrateToPerKind', async () => {
    await permissions.save('test.com', 'nip04Decrypt', null, 'allow');
    await permissions.save('test.com', 'nip44Encrypt', null, 'deny');

    // Migration should NOT delete readMessages/sendMessages keys
    await permissions.migrateToPerKind();

    assert.strictEqual(await permissions.check('test.com', 'nip04Decrypt'), 'allow');
    assert.strictEqual(await permissions.check('test.com', 'nip44Encrypt'), 'deny');
  });
});

describe('permissions -- DM signEvent kinds collapse to sendMessages', () => {
  beforeEach(() => resetMockStorage());

  it('signEvent kinds 4, 13, 14, 1059 map to sendMessages', () => {
    assert.strictEqual(permissions.permissionKey('signEvent', 4), 'sendMessages');
    assert.strictEqual(permissions.permissionKey('signEvent', 13), 'sendMessages');
    assert.strictEqual(permissions.permissionKey('signEvent', 14), 'sendMessages');
    assert.strictEqual(permissions.permissionKey('signEvent', 1059), 'sendMessages');
  });

  it('signEvent kinds outside the DM set keep per-kind permKey', () => {
    assert.strictEqual(permissions.permissionKey('signEvent', 1), 'signEvent:1');
    assert.strictEqual(permissions.permissionKey('signEvent', 0), 'signEvent:0');
    assert.strictEqual(permissions.permissionKey('signEvent', 7), 'signEvent:7');
    assert.strictEqual(permissions.permissionKey('signEvent', 1984), 'signEvent:1984');
  });

  it('save signEvent kind 4 lands in the sendMessages bucket and grants encrypt', async () => {
    await permissions.save('test.com', 'signEvent', 4, 'allow');
    assert.strictEqual(await permissions.check('test.com', 'signEvent', 4), 'allow');
    // The shared key should also auto-grant encrypt + nip44 sign-of-DM
    assert.strictEqual(await permissions.check('test.com', 'nip04Encrypt'), 'allow');
    assert.strictEqual(await permissions.check('test.com', 'nip44Encrypt'), 'allow');
    assert.strictEqual(await permissions.check('test.com', 'signEvent', 1059), 'allow');
    // But should NOT leak into unrelated kinds
    assert.strictEqual(await permissions.check('test.com', 'signEvent', 1), 'ask');
  });
});

describe('permissions -- migrateDmKindsToSendMessages', () => {
  beforeEach(() => resetMockStorage());

  it('moves a stored signEvent:4 entry into sendMessages', async () => {
    // Seed raw storage with a pre-migration entry (using saveDirect to bypass mapping)
    await permissions.saveDirect('chat.com', 'signEvent:4', 'allow');
    await permissions.migrateDmKindsToSendMessages();
    const bucket = await permissions.getForDomain('chat.com');
    assert.strictEqual(bucket['signEvent:4'], undefined, 'old key should be removed');
    assert.strictEqual(bucket['sendMessages'], 'allow', 'value should land under sendMessages');
  });

  it('merges multiple DM kinds with deny-wins semantics', async () => {
    await permissions.saveDirect('chat.com', 'signEvent:4', 'allow');
    await permissions.saveDirect('chat.com', 'signEvent:13', 'deny');
    await permissions.saveDirect('chat.com', 'signEvent:1059', 'allow');
    await permissions.migrateDmKindsToSendMessages();
    const bucket = await permissions.getForDomain('chat.com');
    assert.strictEqual(bucket['signEvent:4'], undefined);
    assert.strictEqual(bucket['signEvent:13'], undefined);
    assert.strictEqual(bucket['signEvent:1059'], undefined);
    assert.strictEqual(bucket['sendMessages'], 'deny', 'deny wins over allow');
  });

  it('preserves a pre-existing sendMessages value when DM kinds are less restrictive', async () => {
    await permissions.saveDirect('chat.com', 'sendMessages', 'deny');
    await permissions.saveDirect('chat.com', 'signEvent:4', 'allow');
    await permissions.migrateDmKindsToSendMessages();
    const bucket = await permissions.getForDomain('chat.com');
    assert.strictEqual(bucket['signEvent:4'], undefined);
    assert.strictEqual(bucket['sendMessages'], 'deny', 'existing deny is preserved');
  });

  it('escalates a pre-existing sendMessages value when a DM kind is more restrictive', async () => {
    await permissions.saveDirect('chat.com', 'sendMessages', 'allow');
    await permissions.saveDirect('chat.com', 'signEvent:13', 'deny');
    await permissions.migrateDmKindsToSendMessages();
    const bucket = await permissions.getForDomain('chat.com');
    assert.strictEqual(bucket['signEvent:13'], undefined);
    assert.strictEqual(bucket['sendMessages'], 'deny', 'deny from migrating kind escalates');
  });

  it('leaves non-DM signEvent kinds untouched', async () => {
    await permissions.saveDirect('chat.com', 'signEvent:1', 'allow');
    await permissions.saveDirect('chat.com', 'signEvent:4', 'allow');
    await permissions.migrateDmKindsToSendMessages();
    const bucket = await permissions.getForDomain('chat.com');
    assert.strictEqual(bucket['signEvent:1'], 'allow', 'non-DM kind survives');
    assert.strictEqual(bucket['sendMessages'], 'allow');
  });

  it('is a no-op when there are no DM signEvent entries', async () => {
    await permissions.saveDirect('chat.com', 'signEvent:1', 'allow');
    await permissions.migrateDmKindsToSendMessages();
    const bucket = await permissions.getForDomain('chat.com');
    assert.strictEqual(bucket['signEvent:1'], 'allow');
    assert.strictEqual(bucket['sendMessages'], undefined);
  });
});

describe('permissions -- setupNewAccountPermissions (wizard fresh vs copy)', () => {
  beforeEach(() => resetMockStorage());

  it('fresh: isolates the new account; existing account keeps perms; switches to per-account', async () => {
    // Default "all accounts" (global) mode: this perm lives in the shared _default bucket.
    await permissions.save('example.com', 'signEvent', 1, 'allow');
    assert.strictEqual(await permissions.getUseGlobalDefaults(), true);

    await permissions.setupNewAccountPermissions('B', ['A'], null);

    assert.strictEqual(await permissions.getUseGlobalDefaults(), false); // switched to per-account
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1, 'A'), 'allow'); // existing preserved
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1, 'B'), 'ask');   // new is fresh
  });

  it('copy: the new account inherits the chosen source account perms', async () => {
    await permissions.save('example.com', 'signEvent', 1, 'allow');

    await permissions.setupNewAccountPermissions('B', ['A'], 'A');

    assert.strictEqual(await permissions.getUseGlobalDefaults(), false);
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1, 'A'), 'allow');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1, 'B'), 'allow'); // copied
  });

  it('already per-account: fresh leaves new account empty, existing untouched', async () => {
    await permissions.setUseGlobalDefaults(false);
    await permissions.save('example.com', 'signEvent', 1, 'allow', 'A');

    await permissions.setupNewAccountPermissions('B', ['A'], null);

    assert.strictEqual(await permissions.getUseGlobalDefaults(), false);
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1, 'A'), 'allow');
    assert.strictEqual(await permissions.check('example.com', 'signEvent', 1, 'B'), 'ask');
  });
});

import { test } from 'node:test';
import { getDomainFromUrl } from '../src/utils/url.ts';
import { originMatchesActiveTab } from '../src/domain/site/originMatchesActiveTab.ts';
import browser from '../src/lib/browser.ts';
import { isDomainAllowed, isWeblnAllowed } from '../src/services/background/domain-handlers.ts';

test('page identity includes scheme and non-default port, with opaque URLs rejected', () => {
  assert.equal(getDomainFromUrl('https://EXAMPLE.com:443/path'), 'https://example.com');
  assert.equal(getDomainFromUrl('http://localhost:3000/path'), 'http://localhost:3000');
  for (const url of ['data:text/plain,x', 'file:///tmp/x', 'about:blank', 'invalid']) assert.equal(getDomainFromUrl(url), null);
  assert.equal(originMatchesActiveTab('http://localhost:4000', 'http://localhost:3000'), false);
  assert.equal(originMatchesActiveTab('https://localhost:3000', 'http://localhost:3000'), false);
  assert.equal(originMatchesActiveTab('http://localhost:3000/a', 'http://localhost:3000'), true);
});

test('legacy hostname consent and account rules continue without renewed consent', async () => {
  resetMockStorage();
  await browser.storage.local.set({allowedDomains:['localhost'], weblnAllowedDomains:['localhost']});
  await permissions.setUseGlobalDefaults(false);
  await permissions.save('localhost', 'getPublicKey', null, 'allow', 'A');
  await permissions.save('localhost', 'signEvent', 1, 'deny', 'A');
  await permissions.save('localhost', 'webln_sendPayment', null, 'allow', 'A');
  for (const origin of ['http://localhost:3000', 'http://localhost:4000', 'https://localhost']) {
    assert.equal(await isDomainAllowed(origin), true);
    assert.equal(await isWeblnAllowed(origin), true);
    assert.equal(await permissions.check(origin, 'getPublicKey', undefined, 'A'), 'allow');
    assert.equal(await permissions.check(origin, 'signEvent', 1, 'A'), 'deny');
    assert.equal(await permissions.check(origin, 'webln_sendPayment', undefined, 'A'), 'allow');
    assert.equal(await permissions.check(origin, 'getPublicKey', undefined, 'B'), 'ask');
  }
  await permissions.save('http://localhost:3000', 'signEvent', 1, 'allow', 'A');
  assert.equal(await permissions.check('http://localhost:3000', 'signEvent', 1, 'A'), 'allow');
  assert.equal(await permissions.check('http://sub.localhost:3000', 'getPublicKey', undefined, 'A'), 'ask');
});

test('new grants remain origin isolated and disconnect revokes applicable legacy grants', async () => {
  resetMockStorage();
  const { addAllowedDomain, addWeblnAllowedDomain, removeAllowedDomain } = await import('../src/services/background/domain-handlers.ts');
  await addAllowedDomain('http://localhost:3000');
  await addWeblnAllowedDomain('http://localhost:3000');
  await permissions.save('http://localhost:3000', 'getPublicKey', null, 'allow');
  assert.equal(await isDomainAllowed('http://localhost:4000'), false);
  assert.equal(await isWeblnAllowed('http://localhost:4000'), false);
  assert.equal(await permissions.check('http://localhost:4000', 'getPublicKey'), 'ask');
  await addAllowedDomain('localhost');
  await addWeblnAllowedDomain('localhost');
  await permissions.save('localhost', 'getPublicKey', null, 'allow');
  await removeAllowedDomain('http://localhost:3000');
  for (const origin of ['http://localhost:3000','http://localhost:4000']) {
    assert.equal(await isDomainAllowed(origin), false);
    assert.equal(await isWeblnAllowed(origin), false);
    assert.equal(await permissions.check(origin, 'getPublicKey'), 'ask');
  }
});


test('explicit inherited rule edits apply only to that origin and bucket, and clear removes fallback', async () => {
  resetMockStorage();
  await permissions.setUseGlobalDefaults(false);
  await permissions.saveDirect('legacy.test', 'getPublicKey', 'deny', 'A');
  await permissions.saveDirect('legacy.test', 'getPublicKey', 'deny', 'B');
  await permissions.saveDirect('legacy.test', 'webln_getBalance', 'allow', 'A');
  await permissions.saveDirect('https://legacy.test', 'getPublicKey', 'allow', 'A');
  assert.equal(await permissions.check('https://legacy.test', 'getPublicKey', undefined, 'A'), 'allow');
  assert.equal((await permissions.getForDomain('https://legacy.test', 'A')).getPublicKey, 'allow');
  assert.equal(await permissions.check('https://legacy.test:8443', 'getPublicKey', undefined, 'A'), 'deny');
  assert.equal(await permissions.check('https://legacy.test', 'getPublicKey', undefined, 'B'), 'deny');
  await permissions.saveDirect('https://legacy.test', 'webln_getBalance', 'ask', 'A');
  assert.equal(await permissions.check('https://legacy.test', 'webln_getBalance', undefined, 'A'), 'ask');
  await permissions.saveDirect('legacy.test', '*', 'deny', 'A');
  assert.equal(await permissions.check('https://legacy.test', 'getPublicKey', undefined, 'A'), 'deny', 'separate broader denial is not edited');
  await permissions.clear('https://legacy.test', 'A');
  assert.deepEqual(await permissions.getForDomain('https://legacy.test', 'A'), {});
  assert.equal(await permissions.check('https://legacy.test', 'getPublicKey', undefined, 'A'), 'ask');
  assert.equal(await permissions.check('https://legacy.test', 'getPublicKey', undefined, 'B'), 'deny');
});

describe('global rules with account overrides', () => {
  beforeEach(() => { resetMockStorage(); permissions.invalidateCache(); });
  it('preserves per-account decisions across migration, including legacy hostname scopes', async () => {
    const {default:browser}=await import('./helpers/browser-mock');
    await browser.storage.local.set({
      signerUseGlobalDefaults:false, accounts:[{id:'a'},{id:'b'}],
      signerPermissions:{
        'example.com':{_default:{readMessages:'allow'},a:{readMessages:'deny',getPublicKey:'allow'}},
        'https://example.com':{_default:{readMessages:'allow','signEvent:1':'deny'},a:{'signEvent:7':'allow'}},
      },
    });
    await permissions.migrateToInheritance();
    assert.equal(await permissions.check('https://example.com','nip04Decrypt',undefined,'a'),'deny');
    assert.equal(await permissions.check('https://example.com','getPublicKey',undefined,'a'),'allow');
    assert.equal(await permissions.check('https://example.com','signEvent',1,'a'),'ask');
    assert.equal(await permissions.check('https://example.com','nip04Decrypt',undefined,'b'),'ask');
    const before=await permissions.getAllRaw();
    await permissions.migrateToInheritance();assert.deepEqual(await permissions.getAllRaw(),before);
  });
  it('does not activate dormant account approvals when migrating global mode',async()=>{
    const {default:browser}=await import('./helpers/browser-mock');
    await browser.storage.local.set({signerUseGlobalDefaults:true,signerPermissions:{
      'https://site.test':{_default:{readMessages:'deny'},a:{readMessages:'allow','signEvent:1':'allow'}},
    }});
    await permissions.migrateToInheritance();
    assert.equal(await permissions.check('https://site.test','nip04Decrypt',undefined,'a'),'deny');
    assert.equal(await permissions.check('https://site.test','signEvent',1,'a'),'ask');
    await permissions.saveDirect('https://site.test','readMessages','allow','a');
    assert.equal(await permissions.check('https://site.test','nip04Decrypt',undefined,'a'),'allow');
    assert.equal(await permissions.check('https://site.test','nip04Decrypt',undefined,'b'),'deny');
    await permissions.inheritRule('https://site.test','readMessages','a');
    assert.equal(await permissions.check('https://site.test','nip04Decrypt',undefined,'a'),'deny');
  });
  it('reset removes only account rule buckets and preserves authentication and globals',async()=>{
    const {default:browser}=await import('./helpers/browser-mock');
    await permissions.migrateToInheritance();
    await permissions.saveDirect('https://site.test','readMessages','allow');
    await permissions.saveDirect('https://site.test','readMessages','deny','a');
    await permissions.saveDirect('https://other.test','readMessages','allow','b');
    const grants=[{id:'relay',accountId:'a',origin:'*',protocol:'nip42',destination:'wss://relay.test/'}];
    await browser.storage.local.set({authenticationGrants:grants});
    await permissions.resetAccountRules();
    assert.deepEqual(await permissions.getAllRaw(),{'_global':{_default:{readMessages:'allow'}}});
    assert.equal(await permissions.check('https://site.test','nip04Decrypt',undefined,'a'),'allow');
    assert.deepEqual((await browser.storage.local.get('authenticationGrants')).authenticationGrants,grants);
    await permissions.saveDirect('https://site.test','readMessages','deny','a');
    await permissions.clearRuleBucket('https://site.test','a');
    assert.equal(await permissions.check('https://site.test','nip04Decrypt',undefined,'a'),'allow');
    await permissions.clearRuleBucket('_global');
    assert.equal(await permissions.check('https://site.test','nip04Decrypt',undefined,'a'),'ask');
    await assert.rejects(permissions.inheritRule('https://site.test','readMessages','_default'));
  });
  it('new-account fresh and copy choices retain their meaning with inherited globals',async()=>{
    await permissions.migrateToInheritance();
    await permissions.saveDirect('https://site.test','readMessages','allow');
    await permissions.saveDirect('https://site.test','readMessages','deny','a');
    await permissions.setupNewAccountPermissions('fresh',['a'],null);
    assert.equal(await permissions.check('https://site.test','nip04Decrypt',undefined,'fresh'),'ask');
    assert.equal(await permissions.check('https://site.test','nip04Decrypt',undefined,'a'),'deny');
    await permissions.setupNewAccountPermissions('copy',['a'],'a');
    assert.equal(await permissions.check('https://site.test','nip04Decrypt',undefined,'copy'),'deny');
    assert.deepEqual((await permissions.getAll('copy'))['https://site.test'],{readMessages:'deny'});
  });
});

it('settings writes migrate before choosing the explicit account bucket',async()=>{
  const {default:browser}=await import('./helpers/browser-mock');
  resetMockStorage();permissions.invalidateCache();
  await browser.storage.local.set({signerUseGlobalDefaults:true,accounts:[{id:'a'}],
    signerPermissions:{'https://site.test':{_default:{readMessages:'allow'}}}});
  const {handlers}=await import('../src/services/background/nip07-handlers');
  await handlers.get('signer_savePermission')!({domain:'https://site.test',methodName:'readMessages',decision:'deny',accountId:'a'});
  assert.equal(await permissions.check('https://site.test','nip04Decrypt',undefined,'a'),'deny');
  assert.equal(await permissions.check('https://site.test','nip04Decrypt',undefined,'b'),'allow');
});


describe('defaults across connected sites', () => {
  beforeEach(async () => { resetMockStorage(); permissions.invalidateCache(); await permissions.migrateToInheritance(); });
  it('does not broaden existing site approvals; explicit global rules apply across sites and accounts', async () => {
    await permissions.saveDirect('https://one.test', 'readMessages', 'allow');
    assert.equal(await permissions.check('https://two.test', 'nip04Decrypt', undefined, 'a'), 'ask');
    await permissions.saveDirect('_global', 'signEvent:1', 'allow');
    for (const site of ['https://one.test', 'https://two.test']) for (const account of ['a', 'b']) {
      assert.equal(await permissions.check(site, 'signEvent', 1, account), 'allow');
    }
    await permissions.saveDirect('https://one.test', 'signEvent:1', 'deny', 'a');
    assert.equal(await permissions.check('https://one.test', 'signEvent', 1, 'a'), 'deny');
    assert.equal(await permissions.check('https://one.test', 'signEvent', 1, 'b'), 'allow');
    assert.equal(await permissions.check('https://two.test', 'signEvent', 1, 'a'), 'allow');
    await permissions.inheritRule('https://one.test', 'signEvent:1', 'a');
    assert.equal(await permissions.check('https://one.test', 'signEvent', 1, 'a'), 'allow');
    assert.ok(!('_global' in await permissions.getAll('a')));
  });
  it('supports ask overrides, fresh accounts, copying and resetting without losing shared defaults', async () => {
    await permissions.saveDirect('_global', 'readMessages', 'allow');
    await permissions.saveDirect('https://one.test', 'readMessages', 'ask', 'a');
    assert.equal(await permissions.check('https://one.test', 'nip04Decrypt', undefined, 'a'), 'ask');
    await permissions.setupNewAccountPermissions('fresh', ['a'], null);
    assert.equal(await permissions.check('https://unknown.test', 'nip04Decrypt', undefined, 'fresh'), 'ask');
    await permissions.setupNewAccountPermissions('copy', ['a','fresh'], 'fresh');
    assert.equal(await permissions.check('https://unknown.test', 'nip04Decrypt', undefined, 'copy'), 'ask');
    await permissions.resetAccountRules();
    assert.equal(await permissions.check('https://unknown.test', 'nip04Decrypt', undefined, 'fresh'), 'allow');
    await permissions.clearRuleBucket('_global');
    assert.equal(await permissions.check('https://unknown.test', 'nip04Decrypt', undefined, 'fresh'), 'ask');
  });
});

describe('one-time migration into visible Global rules', () => {
  beforeEach(() => { resetMockStorage(); permissions.invalidateCache(); });
  it('merges old shared rules into the new global bucket, removes old buckets and runs only once', async () => {
    const {default:browser}=await import('./helpers/browser-mock');
    await browser.storage.local.set({signerRulesInheritance:true, accounts:[{id:'a'}], signerPermissions:{
      _global:{_default:{getPublicKey:'allow'}},
      'https://obelisk.ar':{_default:{readMessages:'deny','signEvent:27235':'ask','signEvent:9007':'allow'}},
    }});
    await Promise.all([permissions.migrateToGlobalRules(),permissions.migrateToGlobalRules()]);
    const raw=await permissions.getAllRaw();
    assert.deepEqual(raw,{_global:{_default:{getPublicKey:'allow',readMessages:'deny','signEvent:27235':'ask','signEvent:9007':'allow'}}});
    assert.deepEqual(await permissions.getForDomain('https://obelisk.ar','a'),raw._global._default);
    await permissions.saveDirect('_global','readMessages','ask');
    await permissions.migrateToGlobalRules();
    assert.equal(await permissions.check('https://obelisk.ar','nip04Decrypt',undefined,'a'),'ask');
    await assert.rejects(permissions.saveDirect('https://obelisk.ar','readMessages','allow'),/require/);
    await assert.rejects(permissions.save('https://obelisk.ar','signEvent',1,'allow'),/require/);
    await assert.rejects(permissions.saveDirect('_global','readMessages','allow','a'),/require/);
  });
  it('preserves explicit new globals and site differences; reset leaves only global inheritance', async () => {
    const {default:browser}=await import('./helpers/browser-mock');
    const grants=[{id:'auth',accountId:'a',protocol:'nip42'}];
    await browser.storage.local.set({signerRulesInheritance:true,accounts:[{id:'a'},{id:'b'}],authenticationGrants:grants,signerPermissions:{
      _global:{_default:{getPublicKey:'allow'}},
      'https://one.test':{_default:{getPublicKey:'deny',readMessages:'allow'},a:{'signEvent:1':'deny'}},
      'https://two.test':{_default:{readMessages:'deny'}},
    }});
    await permissions.migrateToGlobalRules();
    const raw=await permissions.getAllRaw();
    assert.deepEqual(raw._global._default,{getPublicKey:'allow',readMessages:'deny'});
    assert.equal(raw['https://one.test'].a.readMessages,'allow');
    assert.equal(raw['https://one.test'].b.getPublicKey,'deny');
    assert.equal(raw['https://one.test'].a['signEvent:1'],'deny');
    assert.ok(Object.entries(raw).every(([site,buckets])=>site==='_global'||!buckets._default));
    await permissions.clearRuleBucket('https://one.test','a');
    assert.deepEqual(await permissions.getForDomain('https://one.test','a'),raw._global._default);
    await permissions.resetAccountRules();
    assert.deepEqual(await permissions.getAllRaw(),{_global:raw._global});
    assert.deepEqual((await browser.storage.local.get('authenticationGrants')).authenticationGrants,grants);
  });
  it('preserves exact-origin exceptions over migrated legacy hostname overrides',async()=>{
    const {default:browser}=await import('./helpers/browser-mock');
    await browser.storage.local.set({signerRulesInheritance:true,accounts:[{id:'a'}],signerPermissions:{
      'https://one.test':{_default:{readMessages:'deny'}},
      'one.test':{_default:{readMessages:'allow'}},
    }});
    await permissions.migrateToGlobalRules();
    assert.equal(await permissions.check('https://one.test','nip04Decrypt',undefined,'a'),'deny');
    assert.equal(await permissions.check('http://one.test','nip04Decrypt',undefined,'a'),'allow');
  });
  it('makes account-wide exceptions visible on known sites and new accounts use globals',async()=>{
    const {default:browser}=await import('./helpers/browser-mock');
    await browser.storage.local.set({signerRulesInheritance:true,accounts:[{id:'a'}],allowedDomains:['https://site.test'],signerPermissions:{
      _global:{_default:{readMessages:'allow'},a:{readMessages:'ask'}},
    }});
    await permissions.migrateToGlobalRules();
    const raw=await permissions.getAllRaw();
    assert.deepEqual(raw,{_global:{_default:{readMessages:'allow'}},'https://site.test':{a:{readMessages:'ask'}}});
    await permissions.setupNewAccountPermissions('fresh',['a'],null);
    assert.equal(await permissions.check('https://site.test','nip04Decrypt',undefined,'fresh'),'allow');
    await permissions.setupNewAccountPermissions('copy',['a'],'a');
    assert.equal(await permissions.check('https://site.test','nip04Decrypt',undefined,'copy'),'ask');
    await permissions.clearRuleBucket('https://site.test','a');
    assert.equal(await permissions.check('https://site.test','nip04Decrypt',undefined,'a'),'allow');
    assert.ok(!(await permissions.getAllRaw())._global.a);
  });
  it('failed persistence leaves legacy data intact and can safely retry',async t=>{
    const {default:browser}=await import('./helpers/browser-mock');
    const original={'https://one.test':{_default:{readMessages:'deny'}}};
    await browser.storage.local.set({signerRulesInheritance:true,signerPermissions:original});
    const set=browser.storage.local.set.bind(browser.storage.local);
    const mock=t.mock.method(browser.storage.local,'set',async(data:any)=>{
      if(data.signerGlobalRulesVersion)throw new Error('disk unavailable');
      return set(data);
    });
    await assert.rejects(permissions.migrateToGlobalRules(),/disk unavailable/);
    assert.deepEqual(await permissions.getAllRaw(),original);
    assert.equal((await browser.storage.local.get('signerGlobalRulesVersion')).signerGlobalRulesVersion,undefined);
    mock.mock.restore();
    await permissions.migrateToGlobalRules();
    assert.deepEqual(await permissions.getAllRaw(),{_global:{_default:{readMessages:'deny'}}});
  });
});


it('account setup runs consolidation before creating any new permission buckets',async()=>{
  const {default:browser}=await import('./helpers/browser-mock');
  resetMockStorage();permissions.invalidateCache();
  await browser.storage.local.set({accounts:[{id:'a'},{id:'fresh'}],signerPermissions:{
    'https://site.test':{_default:{readMessages:'deny'}},
  }});
  const {handlers}=await import('../src/services/background/nip07-handlers');
  await handlers.get('signer_setupNewAccountPermissions')!({newAccountId:'fresh',copyFromAccountId:null});
  assert.deepEqual(await permissions.getAllRaw(),{_global:{_default:{readMessages:'deny'}}});
  await handlers.get('signer_copyPermissions')!({fromAccountId:'_default',toAccountId:'fresh'});
  assert.deepEqual(await permissions.getAllRaw(),{_global:{_default:{readMessages:'deny'}}});
});
