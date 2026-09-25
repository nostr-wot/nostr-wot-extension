import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { resetMockStorage } from './helpers/browser-mock.ts';
import browser from '../src/lib/browser.ts';
import { extensionStore, localStore } from '../src/services/storage/keyValueStore.ts';

/*
 * The one place the shared packages touch extension storage. Everything above it —
 * permissions, the vault, the signing pipeline — is written against `KeyValueStore` and
 * cannot see `browser.storage` at all, so if this adapter is wrong every one of them is
 * wrong in the same way and none of them can tell.
 */

describe('extension KeyValueStore adapter', () => {
  beforeEach(() => resetMockStorage());

  it('round-trips a value under the key the extension already uses', async () => {
    // Unprefixed on purpose: the packages read the extension's own key names so an
    // existing install finds its data. A namespacing bug here reads as an empty vault.
    await localStore.set('signerPermissions', { 'example.com': { _default: { getPublicKey: 'allow' } } });
    assert.deepEqual(await browser.storage.local.get('signerPermissions'), {
      signerPermissions: { 'example.com': { _default: { getPublicKey: 'allow' } } },
    });
    assert.deepEqual(await localStore.get('signerPermissions'), {
      'example.com': { _default: { getPublicKey: 'allow' } },
    });
  });

  it('reports a missing key as undefined rather than an empty object', async () => {
    // `browser.storage.get` answers `{}` for a key it does not hold; the port requires
    // `undefined`, and a package that stored `{}` as a real value could not tell them apart.
    assert.equal(await localStore.get('nothing-here'), undefined);
  });

  it('stores falsy values as themselves', async () => {
    // `signerUseGlobalDefaults` is a boolean whose false is meaningful: unset means ON.
    await localStore.set('signerUseGlobalDefaults', false);
    assert.equal(await localStore.get('signerUseGlobalDefaults'), false);
    await localStore.set('zero', 0);
    assert.equal(await localStore.get('zero'), 0);
  });

  it('removing a key that is not there is not an error', async () => {
    await localStore.remove('never-set');
    assert.equal(await localStore.get('never-set'), undefined);
  });

  it('keys() reports every key in the area and nothing else', async () => {
    await localStore.set('a', 1);
    await localStore.set('b', 2);
    assert.deepEqual((await localStore.keys()).sort(), ['a', 'b']);
    await localStore.remove('a');
    assert.deepEqual(await localStore.keys(), ['b']);
  });

  it('subscribe fires for this area only, and unsubscribing stops it', async () => {
    const seen: string[] = [];
    const stop = localStore.subscribe!((key) => seen.push(key));

    await localStore.set('watched', 1);
    assert.deepEqual(seen, ['watched']);

    // A write to another area must not invalidate this area's caches.
    await extensionStore('session').set('elsewhere', 1);
    assert.deepEqual(seen, ['watched']);

    await localStore.remove('watched');
    assert.deepEqual(seen, ['watched', 'watched']);

    stop();
    await localStore.set('watched', 2);
    assert.deepEqual(seen, ['watched', 'watched']);
  });

  it('one listener throwing does not cost another its notification', async () => {
    // These listeners invalidate authorization caches. A stale permission cache because a
    // sibling listener threw is a security bug, not a cosmetic one.
    const seen: string[] = [];
    const stopBad = localStore.subscribe!(() => { throw new Error('boom'); });
    const stopGood = localStore.subscribe!((key) => seen.push(key));
    await localStore.set('k', 1);
    assert.deepEqual(seen, ['k']);
    stopBad();
    stopGood();
  });

  it('two stores over the same area see each other\'s writes', async () => {
    // The packages each hold their own store handle over one physical area.
    const other = extensionStore('local');
    await localStore.set('shared', 'value');
    assert.equal(await other.get('shared'), 'value');
  });

  it('the session area is a separate keyspace', async () => {
    const session = extensionStore('session');
    await session.set('only-session', 1);
    assert.equal(await localStore.get('only-session'), undefined);
    assert.equal(await session.get('only-session'), 1);
  });
});
