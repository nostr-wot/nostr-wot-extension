import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { resetMockStorage } from './helpers/browser-mock.ts';
import * as vault from '../src/services/vault/vault.ts';
import { createFromMnemonic, createFromMnemonicAtIndex, importNsec } from '../src/domain/accounts/creation.ts';
import { arrayToBase64, base64ToArray } from '../src/lib/crypto/utils.ts';
import { encryptRecovery, decryptRecovery, recoveryTags, validateRecoveryEvent, recoveryCoordinate } from '../src/services/vault/recoveryCodec.ts';
import { checkRelayRecovery, prepareRelayRecovery, restoreRelayRecovery, publishRelayRecovery, fetchRelayRecovery } from '../src/services/vault/relayRecovery.ts';
import { PASSKEY_RP_ID, LEGACY_PASSKEY_RP_ID, PASSKEY_RECOVERY_PRF } from '../src/constants/passkey.ts';
import { wrapVaultKey, unwrapVaultKey } from '../src/services/vault/passkeyEncryption.ts';
import { DEFAULT_RELAYS } from '../src/constants/relays.ts';
import type { RecoveryContext } from '../src/services/vault/recoveryCodec.ts';
import type { PasskeyInput, RecoveryScope } from '../src/domain/vault/passkey.ts';
import type { SignedEvent } from '../src/domain/nostr/types.ts';

const mnemonic = 'abandon '.repeat(11) + 'about';
const prf = arrayToBase64(new Uint8Array(32).fill(7));
const metadata = { credentialId: 'AQID', prfSalt: PASSKEY_RECOVERY_PRF, prf, rpId: PASSKEY_RP_ID };
let pubkey: string;
const context = (scope: RecoveryScope): RecoveryContext => ({ credentialId: metadata.credentialId, rpId: PASSKEY_RP_ID, pubkey, scope });
async function setup(scope: RecoveryScope) {
  const main = await createFromMnemonic(mnemonic);
  const derived = await createFromMnemonicAtIndex(mnemonic, 1);
  const independent = await importNsec('09'.repeat(32));
  pubkey = main.pubkey;
  const passkey: PasskeyInput = { ...metadata, recoveryPubkey: pubkey, recoveryScope: scope };
  await vault.create('', { accounts: [main, derived, independent], activeAccountId: main.id }, passkey);
  return { main, derived, independent, passkey };
}
beforeEach(() => { vault.lock(); resetMockStorage(); });
afterEach(() => vault.lock());

describe('recovery encryption and identity checks', () => {
  it('matches independently derived Keytr v1 and typed v4 ciphertext in both directions', async () => {
    pubkey = 'ab'.repeat(32);
    for (const scope of ['private-key', 'seed', 'vault'] as const) {
      const ctx = context(scope);
      const plaintext = scope === 'private-key' ? new Uint8Array(32).fill(1) : new TextEncoder().encode('{"payload":"test"}');
      const content = await encryptRecovery(plaintext, prf, ctx);
      const bytes = base64ToArray(content);
      const material = await webcrypto.subtle.importKey('raw', new Uint8Array(32).fill(7), 'HKDF', false, ['deriveKey']);
      const key = await webcrypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: bytes.slice(13, 45), info: new TextEncoder().encode(scope === 'private-key' ? 'keytr nsec encryption v1' : 'keytr payload encryption v4') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const aad = scope === 'private-key' ? new Uint8Array([...new TextEncoder().encode('keytr'), 1, 1, 2, 3]) : new TextEncoder().encode(JSON.stringify(['keytr', 4, scope, `com.nostrwot.${scope}.v1`, ctx.rpId, pubkey, 'AQID']));
      assert.deepEqual(new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(1, 13), additionalData: aad }, key, bytes.slice(45))), plaintext);
      assert.deepEqual(await decryptRecovery(content, prf, ctx), plaintext);
      await assert.rejects(decryptRecovery(content, arrayToBase64(new Uint8Array(32)), ctx));
      await assert.rejects(decryptRecovery(content, prf, { ...ctx, credentialId: 'AQIE' }));
      if (scope !== 'private-key') await assert.rejects(decryptRecovery(content, prf, { ...ctx, rpId: 'other.example' }));
    }
  });
  it('bounds formats and rejects malformed context without downgrading', async () => {
    pubkey = 'ab'.repeat(32); const ctx = context('vault');
    for (const bytes of [new Uint8Array(), new Uint8Array(65537)]) await assert.rejects(encryptRecovery(bytes, prf, ctx));
    for (const content of ['', '!', 'A'.repeat(100000)]) await assert.rejects(decryptRecovery(content, prf, ctx));
    assert.throws(() => recoveryCoordinate({ ...ctx, scope: 'other' as RecoveryScope }));
    assert.throws(() => recoveryTags({ ...ctx, rpId: 'https://example.com' }));
  });
  it('keeps the legacy RP authenticated and rejects substituting the new RP', async () => {
    const input = { credentialId: 'AQID', prfSalt: arrayToBase64(new Uint8Array(32)), prf };
    const raw = new Uint8Array(32).fill(4); const wrapper = await wrapVaultKey(raw, input);
    assert.equal(LEGACY_PASSKEY_RP_ID, 'passkeys.nostr-wot.com');
    assert.deepEqual(await unwrapVaultKey(wrapper, input), raw);
    await assert.rejects(unwrapVaultKey({ ...wrapper, rpId: PASSKEY_RP_ID }, input));
  });
});

describe('background relay recovery', () => {
  for (const index of [undefined, 3]) it(`round-trips a legacy seed account without a path (index ${index ?? 'absent'})`, async () => {
    const account = await createFromMnemonicAtIndex(mnemonic, index ?? 0);
    const expectedPath = account.derivationPath;
    delete account.derivationPath;
    if (index === undefined) delete account.derivationIndex;
    pubkey = account.pubkey;
    await vault.create('', { accounts: [account], activeAccountId: account.id }, { ...metadata, recoveryPubkey: pubkey, recoveryScope: 'seed' });
    const event = await prepareRelayRecovery(metadata);
    await vault.destroy();
    await restoreRelayRecovery(event, metadata, context('seed'));
    assert.equal(vault.getActivePubkey(), pubkey);
    assert.equal(vault.getDecryptedPayload().accounts[0].derivationPath, expectedPath);
    assert.equal(vault.getDecryptedPayload().accounts[0].mnemonic, mnemonic);
  });
  for (const variant of ['wrong-index', 'wrong-path', 'invalid-index'] as const) it(`rejects seed recovery export with ${variant} before producing a snapshot`, async () => {
    const account = await createFromMnemonic(mnemonic);
    if (variant === 'wrong-path') account.derivationPath = "m/44'/1237'/0'/0/1";
    else {
      delete account.derivationPath;
      account.derivationIndex = variant === 'wrong-index' ? 1 : -1;
    }
    pubkey = account.pubkey;
    await vault.create('', { accounts: [account], activeAccountId: account.id }, { ...metadata, recoveryPubkey: pubkey, recoveryScope: 'seed' });
    await assert.rejects(prepareRelayRecovery(metadata), /derivation|match/i);
    assert.equal(vault.getActivePubkey(), pubkey);
  });
  for (const scope of ['private-key', 'seed', 'vault'] as const) it(`exports only the selected seed account despite legacy ${scope} metadata`, async () => {
    const original = await setup(scope);
    const event = await prepareRelayRecovery(metadata);
    assert.equal(JSON.stringify(event).includes(mnemonic), false);
    assert.equal(JSON.stringify(event).includes('"prf"'), false);
    await validateRecoveryEvent(event, context('seed'));
    await vault.destroy();
    await restoreRelayRecovery(event, metadata, context('seed'));
    assert.equal(vault.getActivePubkey(), original.main.pubkey);
    assert.equal(vault.listAccounts().length, 1);
    const restored = vault.getDecryptedPayload();
    assert.equal(restored.accounts[0].mnemonic, mnemonic);
    vault.lock(); assert.equal(await vault.unlockPasskey(metadata), true);
  });
  it('rejects tampering, wrong scope, wrong PRF and populated-vault overwrite', async () => {
    await setup('vault'); const event = await prepareRelayRecovery(metadata);
    await assert.rejects(validateRecoveryEvent({ ...event, sig: '0'.repeat(128) }, context('seed')));
    await assert.rejects(validateRecoveryEvent({ ...event, tags: [...event.tags, ['v', '4']] }, context('seed')));
    await assert.rejects(validateRecoveryEvent(event, context('private-key')));
    await assert.rejects(restoreRelayRecovery(event, { ...metadata, prf: arrayToBase64(new Uint8Array(32)) }, context('seed')));
    await assert.rejects(restoreRelayRecovery(event, metadata, context('seed')), /already exists/);
    assert.equal(vault.listAccounts().length, 3);
  });
  it('publishes all destinations concurrently and reports partial and total failure', async () => {
    await setup('vault'); const event = await prepareRelayRecovery(metadata); const calls: string[] = [];
    const publish = async (relay: string) => { calls.push(relay); return { accepted: relay === new URL(DEFAULT_RELAYS[0]).toString(), message: '' }; };
    const results = await publishRelayRecovery(event, context('seed'), publish);
    assert.deepEqual(calls, DEFAULT_RELAYS.map(url => new URL(url).toString())); assert.equal(results.filter(r => r.accepted).length, 1);
    await assert.rejects(publishRelayRecovery(event, context('seed'), async () => ({ accepted: false, message: 'failed' })), /any relay/);
    vault.lock(); await assert.rejects(publishRelayRecovery(event, context('seed'), publish), /locked/);
  });
  it('selects the newest validated event and does not write during lookup', async () => {
    await setup('vault'); const event = await prepareRelayRecovery(metadata); const before = await vault.exportPasskeyBackup();
    const queried: string[] = [];
    const query = async (relay: string) => { queried.push(relay); return { events: [event], status: 'eose' as const, received: 1 }; };
    assert.equal((await fetchRelayRecovery(context('seed'), query)).id, event.id);
    assert.deepEqual(queried, DEFAULT_RELAYS.map(url => new URL(url).toString())); assert.equal(await vault.exportPasskeyBackup(), before);
    await assert.rejects(fetchRelayRecovery(context('seed'), async () => ({ events: [], status: 'eose', received: 0 })), /No recovery/);
  });
  it('rejects malformed and wrong-author signed data before publication', async () => {
    await setup('vault'); const event = await prepareRelayRecovery(metadata);
    const never = async () => { assert.fail('invalid recovery was published'); return { accepted: true, message: '' }; };
    await assert.rejects(publishRelayRecovery({ ...event, pubkey: 'aa'.repeat(32) }, context('seed'), never));
    await assert.rejects(restoreRelayRecovery(event as SignedEvent, { ...metadata, credentialId: 'different' }, context('seed')));
  });
});

it('does not silently recover a different account when the active account changes', async () => {
  const original = await setup('seed');
  const event = await prepareRelayRecovery(metadata);
  await vault.setActiveAccount(original.derived.id);
  await assert.rejects(prepareRelayRecovery(metadata), /another account/);
  await assert.rejects(publishRelayRecovery(event, context('seed'), async () => assert.fail('must not publish a stale selected account')));
});

it('exports a private key automatically for a selected account without a seed', async () => {
  const account = await importNsec('09'.repeat(32)); pubkey = account.pubkey;
  await vault.create('', { accounts: [account], activeAccountId: account.id }, { ...metadata, recoveryPubkey: pubkey, recoveryScope: 'vault' });
  const event = await prepareRelayRecovery(metadata);
  await validateRecoveryEvent(event, context('private-key'));
  await vault.destroy();
  await restoreRelayRecovery(event, metadata, context('private-key'));
  assert.equal(vault.getActivePubkey(), account.pubkey);
  assert.equal(vault.listAccounts().length, 1);
  assert.equal(vault.getDecryptedPayload().accounts[0].mnemonic, null);
});

it('retains restoration support for previously saved full-vault snapshots', async () => {
  const original = await setup('vault');
  const content = await encryptRecovery(new TextEncoder().encode(await vault.exportPasskeyBackup()), prf, context('vault'));
  const { signEvent } = await import('../src/lib/crypto/nip01.ts');
  const { hexToBytes } = await import('../src/lib/crypto/utils.ts');
  const event = await signEvent({ kind: 31777, pubkey, created_at: 1, content, tags: recoveryTags(context('vault')) }, hexToBytes(original.main.privkey!));
  await vault.destroy();
  await restoreRelayRecovery(event, metadata, context('vault'));
  assert.equal(vault.listAccounts().length, 3);
});


it('checks all recovery relays concurrently and distinguishes missing copies from unavailable relays', async () => {
  await setup('seed');
  const event = await prepareRelayRecovery(metadata);
  const before = await vault.exportPasskeyBackup();
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const checking = checkRelayRecovery(metadata.credentialId, async (relay, filter) => {
    calls.push(relay);
    assert.deepEqual(filter.authors, [pubkey]);
    assert.ok(filter['#d']?.includes(recoveryCoordinate(context('seed'))));
    if (calls.length === DEFAULT_RELAYS.length) release();
    await gate;
    return { events: relay === new URL(DEFAULT_RELAYS[0]).toString() ? [event] : [], status: relay === new URL(DEFAULT_RELAYS[2]).toString() ? 'timeout' : 'eose', received: 0 };
  });
  const results = await checking;
  assert.deepEqual(results.map(item => item.status), ['found', 'missing', 'unavailable']);
  assert.equal(results[0].eventId, event.id);
  assert.equal(await vault.exportPasskeyBackup(), before);
  const invalid = await checkRelayRecovery(metadata.credentialId, async () => ({ events: [{ ...event, sig: '0'.repeat(128) }], status: 'eose', received: 1 }));
  assert.ok(invalid.every(item => item.status === 'invalid'));
  await assert.rejects(checkRelayRecovery('unknown'), /locator/);
});

it('tracks confirmed storage, validates custom relays and records only accepted publications', async () => {
  await setup('seed');
  const { getRecoveryStatus, recordBlobSaved, recordBlobUnavailable, addRecoveryRelay } = await import('../src/services/vault/recoveryStatus.ts');
  assert.equal((await getRecoveryStatus(metadata.credentialId)).blobSaved, null);
  await recordBlobUnavailable(metadata.credentialId);
  assert.equal((await getRecoveryStatus(metadata.credentialId)).blobSaved, false);
  await recordBlobSaved(metadata.credentialId);
  await recordBlobUnavailable(metadata.credentialId);
  assert.equal((await getRecoveryStatus(metadata.credentialId)).blobSaved, true, 'a later failed write does not erase evidence of a saved blob');
  await assert.rejects(addRecoveryRelay(metadata.credentialId, 'https://example.com'));
  await assert.rejects(addRecoveryRelay(metadata.credentialId, 'wss://user:secret@example.com'));
  await assert.rejects(addRecoveryRelay('unknown', 'wss://example.com'));
  await addRecoveryRelay(metadata.credentialId, 'wss://example.com');
  await addRecoveryRelay(metadata.credentialId, 'wss://example.com/');
  const state = await getRecoveryStatus(metadata.credentialId);
  assert.equal(state.relays.length, DEFAULT_RELAYS.length + 1);
  const event = await prepareRelayRecovery(metadata);
  const result = await publishRelayRecovery(event, context('seed'), async relay => ({ accepted: relay === 'wss://example.com/', message: '' }));
  assert.equal(result.length, state.relays.length);
  assert.deepEqual(Object.keys((await getRecoveryStatus(metadata.credentialId)).accepted), ['wss://example.com/']);
  assert.equal((await getRecoveryStatus(metadata.credentialId)).accepted['wss://example.com/'].eventId, event.id);
  const health = await checkRelayRecovery(metadata.credentialId, async relay => ({ status: 'eose', events: relay === 'wss://example.com/' ? [event] : [], received: 0 }));
  assert.equal(health.at(-1)?.status, 'found');
  vault.lock();
  await assert.rejects(addRecoveryRelay(metadata.credentialId, 'wss://other.example.com'), /locked/);
});
