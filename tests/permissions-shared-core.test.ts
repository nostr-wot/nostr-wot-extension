import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resetMockStorage } from './helpers/browser-mock.ts';
import browser from '../src/lib/browser.ts';
import * as permissions from '../src/services/permissions/permissions.ts';

/*
 * What changed when `src/services/permissions/permissions.ts` became an adapter over
 * `@nostr-wot/permissions`. `tests/permissions.test.ts` still owns the cascade, the storage
 * model and the migrations; this file pins only the behaviours that are new, so that the
 * next person to read the two files can see which is which.
 *
 * Every one of these is the package failing closed where the extension did not.
 */

describe('permissions adapter -- a remembered blanket deny survives migrateToPerKind', () => {
  beforeEach(() => resetMockStorage());

  it('keeps a blanket deny while still dropping a blanket grant', async () => {
    // The extension's migration deleted every blanket key — grants AND denials — as
    // "no longer meaningful in the per-kind model". Only the grants were: the cascade still
    // consults the bare method and the wildcard, so a blanket deny is a refusal in force,
    // and it is exactly what "deny, for every kind" writes today. Because background.ts
    // re-runs the migrations on startup, deleting them meant a user's remembered refusal
    // could be dropped and the site would start being asked about again.
    await permissions.saveDirect('site.test', 'signEvent', 'deny');
    await permissions.saveDirect('site.test', '*', 'deny');
    await permissions.saveDirect('other.test', 'signEvent', 'allow');

    await permissions.migrateToPerKind();

    const kept = await permissions.getForDomain('site.test');
    assert.equal(kept['signEvent'], 'deny', 'blanket deny is a refusal in force, not a retired grant');
    assert.equal(kept['*'], 'deny');
    assert.equal(await permissions.check('site.test', 'signEvent', 1), 'deny');

    const dropped = await permissions.getForDomain('other.test');
    assert.equal(dropped['signEvent'], undefined, 'a blanket grant is still retired');
  });

  it('survives the migration being run repeatedly, as background startup does', async () => {
    await permissions.saveDirect('site.test', 'signEvent', 'deny');
    for (let i = 0; i < 3; i++) await permissions.migrateToPerKind();
    assert.equal(await permissions.check('site.test', 'signEvent', 1), 'deny');
  });
});

describe('permissions adapter -- per-account mode fails closed without an account id', () => {
  beforeEach(() => resetMockStorage());

  it('does not read the shared bucket for a request that names no account', async () => {
    // The extension resolved its bucket as `accountId || '_default'` in BOTH modes, so a
    // call that forgot the account while in per-account mode silently read the bucket every
    // account shares. That is a cross-account grant, and it is invisible.
    await permissions.save('site.test', 'getPublicKey', null, 'allow'); // global mode: _default
    await permissions.setUseGlobalDefaults(false);

    assert.equal(await permissions.check('site.test', 'getPublicKey', undefined, 'acct'), 'ask');
    assert.equal(await permissions.check('site.test', 'getPublicKey'), 'ask', 'no account means no bucket, not the shared one');
    assert.deepEqual(await permissions.getAll(), {});
  });

  it('refuses a write that has nowhere to go rather than landing it in _default', async () => {
    await permissions.setUseGlobalDefaults(false);
    await assert.rejects(
      () => permissions.save('site.test', 'getPublicKey', null, 'allow'),
      /accountId/,
      'writing an unattributed grant into the shared bucket is the failure this prevents',
    );
    assert.deepEqual(await permissions.getAllRaw(), {});
  });

  it('still uses the shared bucket in global mode, where it is the correct one', async () => {
    await permissions.save('site.test', 'getPublicKey', null, 'allow');
    assert.equal(await permissions.check('site.test', 'getPublicKey'), 'allow');
    assert.equal(await permissions.check('site.test', 'getPublicKey', undefined, 'any-account'), 'allow');
  });
});

describe('permissions adapter -- the caller label is canonicalised before it reaches the store', () => {
  beforeEach(() => resetMockStorage());

  it('a deny stored for a hostname is not dodged by respelling it', async () => {
    // `Permissions.check` reads the origin AS GIVEN. `@nostr-wot/signer-core` canonicalises
    // at its boundary; this extension calls the package directly, so the adapter is that
    // boundary. Without it `EXAMPLE.COM.` is its own permission key and misses the deny.
    await permissions.saveDirect('example.com', 'getPublicKey', 'deny');
    for (const spelling of ['example.com', 'EXAMPLE.COM', 'Example.Com.']) {
      assert.equal(await permissions.check(spelling, 'getPublicKey'), 'deny', spelling);
    }
  });

  it('an http(s) origin folds default ports and case to one stored key', async () => {
    await permissions.saveDirect('https://site.test', 'getPublicKey', 'deny');
    for (const spelling of ['https://site.test', 'https://SITE.test:443', 'HTTPS://site.test']) {
      assert.equal(await permissions.check(spelling, 'getPublicKey'), 'deny', spelling);
    }
    // A different port is a different origin, and still inherits the hostname scope only.
    assert.equal(await permissions.check('https://site.test:8443', 'getPublicKey'), 'ask');
    assert.deepEqual(Object.keys(await permissions.getAllRaw()), ['https://site.test']);
  });

  it('a label that is neither an origin nor a hostname is its own key, untouched', async () => {
    const internal = 'nip46:AbCd';
    await permissions.saveDirect(internal, 'getPublicKey', 'allow');
    assert.deepEqual(Object.keys(await permissions.getAllRaw()), [internal]);
    assert.equal(await permissions.check(internal, 'getPublicKey'), 'allow');
  });
});

describe('permissions adapter -- storage stays where existing installs left it', () => {
  beforeEach(() => resetMockStorage());

  it('writes the extension\'s own storage keys, unprefixed', async () => {
    // The package could have been given a namespaced view of the store. It was not, because
    // the key names are wire format: an install that updates has to find the tree it wrote.
    await permissions.save('site.test', 'getPublicKey', null, 'allow');
    await permissions.setUseGlobalDefaults(false);
    const keys = Object.keys(await browser.storage.local.get(null));
    assert.ok(keys.includes('signerPermissions'), keys.join(','));
    assert.ok(keys.includes('signerUseGlobalDefaults'), keys.join(','));
  });

  it('reads a tree written by the pre-migration extension unchanged', async () => {
    await browser.storage.local.set({
      signerPermissions: { 'legacy.test': { _default: { 'signEvent:1': 'allow', readMessages: 'deny' } } },
    });
    permissions.invalidateCache();
    assert.equal(await permissions.check('legacy.test', 'signEvent', 1), 'allow');
    assert.equal(await permissions.check('legacy.test', 'nip44Decrypt'), 'deny');
  });
});
