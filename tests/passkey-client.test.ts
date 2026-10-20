import browser from './helpers/browser-mock.ts';
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatePasskey, createPasskey, passkeysAvailable, parsePasskeyBackupMetadata } from '../src/services/vault/passkeyClient.ts';
import { PASSKEY_RP_ID } from '../src/constants/passkey.ts';
import { arrayToBase64 } from '../src/lib/crypto/utils.ts';

const originalCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
const originalPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
const id = new Uint8Array([1, 2, 3]);
const metadata = { rpId: PASSKEY_RP_ID, credentialId: arrayToBase64(id), prfSalt: arrayToBase64(new Uint8Array(32)) };
function install(get: (options: any) => Promise<any>, create: (options: any) => Promise<any> = async () => null) {
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get, create } });
}
afterEach(() => {
  if (originalCredentials) Object.defineProperty(navigator, 'credentials', originalCredentials); else Reflect.deleteProperty(navigator, 'credentials');
  if (originalPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', originalPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
});

describe('WebAuthn PRF client', () => {
  it('turns browser cancellation into concise retry guidance without the specification URL', async () => {
    install(async () => { throw new DOMException('See https://www.w3.org/TR/webauthn-2/', 'NotAllowedError'); });
    await assert.rejects(authenticatePasskey(metadata), error => {
      assert.equal((error as Error).message, 'passkey.cancelled');
      return true;
    });
  });
  it('detects unavailable APIs without starting enrollment', async () => {
    Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: undefined });
    assert.equal(passkeysAvailable(), false);
    await assert.rejects(createPasskey('Test'), /unavailable/);
  });
  it('obtains PRF with a separate assertion only when registration supplies no result', async () => {
    const calls: any[] = [];
    const result = new Uint8Array(32).fill(9);
    install(async options => {
      calls.push(options.publicKey);
      return { rawId: id.buffer, getClientExtensionResults: () => ({ prf: { results: { first: result.buffer } } }) };
    }, async options => {
      calls.push(options.publicKey);
      return { rawId: id.buffer, getClientExtensionResults: () => ({ prf: { enabled: true }, largeBlob: { supported: true } }) };
    });
    assert.equal(passkeysAvailable(), true);
    const credential = await createPasskey('Test');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].rp.id, PASSKEY_RP_ID);
    assert.deepEqual(calls[0].extensions.largeBlob, { support: 'preferred' });
    assert.equal(credential.largeBlobSupported, true);
    assert.equal(credential.name, 'Test');
    assert.equal(calls[0].user.name, 'Test');
    assert.equal(calls[0].authenticatorSelection.userVerification, 'required');
    assert.equal(calls[0].authenticatorSelection.residentKey, 'required');
    assert.equal(calls[0].authenticatorSelection.authenticatorAttachment, undefined);
    assert.equal(calls[0].hints, undefined);
    assert.equal(calls[1].allowCredentials[0].transports, undefined);
    assert.equal(calls[1].rpId, PASSKEY_RP_ID);
    assert.equal(calls[1].userVerification, 'required');
    assert.notDeepEqual(calls[0].challenge, calls[1].challenge);
    assert.equal(credential.prf, arrayToBase64(new Uint8Array(32).fill(9)));
    assert.ok(result.every(n => n === 0));
  });
  it('uses Main for the first local enrollment and numbered defaults for subsequent credentials', async () => {
    const names: string[] = [];
    install(async () => assert.fail('unexpected assertion'), async ({ publicKey }) => {
      names.push(publicKey.user.name);
      assert.equal(publicKey.user.displayName, publicKey.user.name);
      return { rawId: new Uint8Array([4, 5, 6]).buffer, getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(9).buffer } } }) };
    });
    assert.equal((await createPasskey('')).name, 'Nostr WoT Main');
    assert.equal((await createPasskey(' ', { excludeCredentials: [metadata] })).name, 'Nostr WoT Account 2');
    assert.equal((await createPasskey(' Hardware key ')).name, 'Hardware key');
    assert.deepEqual(names, ['Nostr WoT Main', 'Nostr WoT Account 2', 'Hardware key']);
  });
  it('reuses the verified registration PRF without another biometric request', async () => {
    const result = new Uint8Array(32).fill(9);
    install(async () => { assert.fail('registration already supplied PRF'); }, async () => ({ rawId: id.buffer, getClientExtensionResults: () => ({ prf: { results: { first: result.buffer } }, largeBlob: { supported: true } }) }));
    const credential = await createPasskey('Test');
    assert.equal(credential.prf, arrayToBase64(new Uint8Array(32).fill(9)));
    assert.ok(result.every(n => n === 0));
  });
  it('excludes existing credentials only in the requested domain when adding another passkey', async () => {
    install(async () => assert.fail('unexpected assertion'), async ({ publicKey }) => {
      assert.deepEqual(publicKey.excludeCredentials.map((item: any) => [...new Uint8Array(item.id)]), [[1, 2, 3]]);
      return { rawId: new Uint8Array([4, 5, 6]).buffer, getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(9).buffer } } }) };
    });
    await createPasskey('Test', { excludeCredentials: [metadata, { ...metadata, credentialId: 'BAUG', rpId: 'other.example.com' }] });
  });
  it('refuses cancellation, other credentials and missing PRF without downgrade', async () => {
    install(async () => null);
    await assert.rejects(authenticatePasskey(metadata), /cancelled/);
    install(async () => ({ rawId: new Uint8Array([9]).buffer }));
    await assert.rejects(authenticatePasskey(metadata), /did not match/);
    install(async () => ({ rawId: id.buffer, getClientExtensionResults: () => ({}) }));
    await assert.rejects(authenticatePasskey(metadata), /PRF is unavailable/);
    await assert.rejects(createPasskey('Test'), /cancelled/);
  });
  it('rejects non-vault recovery files before requesting credentials', () => {
    assert.throws(() => parsePasskeyBackupMetadata('{}'), /Invalid/);
  });
});

// Recovery must be discoverable without local extension metadata.
describe('passkey-attached recovery', () => {
  const backup = JSON.stringify({ format: 'nostr-wot-passkey-vault', vault: {
    version: 2, protection: 'passkey', rpId: PASSKEY_RP_ID,
    passkeys: [{ ...metadata, iv: arrayToBase64(new Uint8Array(12)), ciphertext: arrayToBase64(new Uint8Array(48)) }],
    iv: arrayToBase64(new Uint8Array(12)), ciphertext: arrayToBase64(new Uint8Array(16)),
  } });
  it('writes encrypted recovery with one verified request and requires provider confirmation', async context => {
    context.mock.method(browser.runtime, 'sendMessage', async (message: any) => { assert.equal(message.method, 'vault_recordBlobSaved'); return { result: true }; });
    const { savePasskeyRecovery } = await import('../src/services/vault/passkeyRecovery.ts');
    const calls: any[] = [];
    install(async ({ publicKey }) => {
      calls.push(publicKey);
      assert.equal(publicKey.rpId, PASSKEY_RP_ID);
      assert.equal(publicKey.userVerification, 'required');
      assert.deepEqual(new Uint8Array(publicKey.allowCredentials[0].id), id);
      return { rawId: id.buffer, getClientExtensionResults: () => ({ largeBlob: publicKey.extensions.largeBlob.write ? { written: true } : { blob: new TextEncoder().encode(backup).buffer } }) };
    });
    await savePasskeyRecovery(backup, metadata.credentialId);
    assert.equal(calls.length, 1);
    assert.equal(new TextDecoder().decode(calls[0].extensions.largeBlob.write), backup);
  });
  it('fails closed on refused or unconfirmed writes and wrong credentials', async () => {
    const { savePasskeyRecovery } = await import('../src/services/vault/passkeyRecovery.ts');
    for (const result of [{}, { largeBlob: { written: false } }]) {
      install(async () => ({ rawId: id.buffer, getClientExtensionResults: () => result }));
      await assert.rejects(savePasskeyRecovery(backup, metadata.credentialId));
    }
    install(async () => ({ rawId: new Uint8Array([9]).buffer }));
    await assert.rejects(savePasskeyRecovery(backup, metadata.credentialId));
    await assert.rejects(savePasskeyRecovery('{}', metadata.credentialId));
  });
  it('discovers a blob without credential IDs then requests PRF only for its matching credential', async () => {
    const { restorePasskeyRecovery } = await import('../src/services/vault/passkeyRecovery.ts');
    let calls = 0;
    install(async ({ publicKey }) => {
      calls++;
      if (calls === 1) {
        assert.equal(publicKey.allowCredentials, undefined);
        assert.equal(publicKey.extensions.largeBlob.read, true);
        return { rawId: id.buffer, getClientExtensionResults: () => ({ largeBlob: { blob: new TextEncoder().encode(backup).buffer } }) };
      }
      assert.deepEqual(new Uint8Array(publicKey.allowCredentials[0].id), id);
      return { rawId: id.buffer, getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(7).buffer } } }) };
    });
    const restored = await restorePasskeyRecovery();
    assert.ok('backup' in restored);
    assert.equal(restored.backup, backup);
    assert.equal(restored.proof.credentialId, metadata.credentialId);
    assert.equal(calls, 2);
  });
  it('rejects unsupported, oversized, foreign and malformed recovery before PRF or persistence', async () => {
    const { restorePasskeyRecovery, savePasskeyRecovery } = await import('../src/services/vault/passkeyRecovery.ts');
    for (const blob of [undefined, new ArrayBuffer(65537), new TextEncoder().encode('{}').buffer]) {
      let calls = 0;
      install(async () => { calls++; return { rawId: id.buffer, getClientExtensionResults: () => ({ largeBlob: { blob } }) }; });
      await assert.rejects(restorePasskeyRecovery());
      assert.equal(calls, 1);
    }
    install(async () => ({ rawId: new Uint8Array([8]).buffer, getClientExtensionResults: () => ({ largeBlob: { blob: new TextEncoder().encode(backup).buffer } }) }));
    await assert.rejects(restorePasskeyRecovery());
    await assert.rejects(savePasskeyRecovery(backup, 'CA=='));
  });
});

it('restores modern blob recovery with one verification and clears its PRF output', async () => {
 const { restorePasskeyRecovery } = await import('../src/services/vault/passkeyRecovery');
 const { PASSKEY_RECOVERY_PRF } = await import('../src/constants/passkey');
 const backup = JSON.stringify({ format: 'nostr-wot-passkey-vault', vault: {
  version: 2, protection: 'passkey', rpId: PASSKEY_RP_ID,
  passkeys: [{ ...metadata, prfSalt: PASSKEY_RECOVERY_PRF, iv: arrayToBase64(new Uint8Array(12)), ciphertext: arrayToBase64(new Uint8Array(48)) }],
  iv: arrayToBase64(new Uint8Array(12)), ciphertext: arrayToBase64(new Uint8Array(16)),
 } });
 let calls = 0; const output = new Uint8Array(32).fill(7);
 install(async ({ publicKey }) => {
  calls++;
  assert.equal(publicKey.extensions.largeBlob.read, true);
  assert.ok(publicKey.extensions.prf.eval.first);
  return { rawId: id.buffer, getClientExtensionResults: () => ({ largeBlob: { blob: new TextEncoder().encode(backup).buffer }, prf: { results: { first: output.buffer } } }) };
 });
 const result = await restorePasskeyRecovery();
 assert.equal(calls, 1);
 assert.equal(result.proof.prf, arrayToBase64(new Uint8Array(32).fill(7)));
 assert.ok(output.every(byte => byte === 0));
});

it('reuses the discovery verification for relay recovery without asking for a second fingerprint', async context => {
 const { restorePasskeyRecovery } = await import('../src/services/vault/passkeyRecovery');
 const { recoveryTags } = await import('../src/services/vault/recoveryCodec');
 const pubkey = 'ab'.repeat(32); let calls = 0;
 context.mock.method(browser.runtime, 'sendMessage', async () => ({ result: { tags: recoveryTags({ credentialId: metadata.credentialId, rpId: PASSKEY_RP_ID, pubkey, scope: 'seed' }) } }));
 const output = new Uint8Array(32).fill(8);
 install(async () => { calls++; return { rawId: id.buffer, response: { userHandle: new Uint8Array(32).fill(0xab).buffer }, getClientExtensionResults: () => ({ prf: { results: { first: output.buffer } } }) }; });
 const result = await restorePasskeyRecovery();
 assert.ok('event' in result);
 assert.equal(calls, 1);
 assert.ok(output.every(byte => byte === 0));
});
