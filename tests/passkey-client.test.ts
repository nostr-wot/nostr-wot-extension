import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatePasskey, createPasskey, passkeysAvailable, parsePasskeyBackupMetadata } from '../src/services/vault/passkeyClient.ts';
import { PASSKEY_RP_ID } from '../src/constants/passkey.ts';
import { arrayToBase64 } from '../src/lib/crypto/utils.ts';

const originalCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
const originalPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
const id = new Uint8Array([1, 2, 3]);
const metadata = { credentialId: arrayToBase64(id), prfSalt: arrayToBase64(new Uint8Array(32)) };
function install(get: (options: any) => Promise<any>, create: (options: any) => Promise<any> = async () => null) {
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get, create } });
}
afterEach(() => {
  if (originalCredentials) Object.defineProperty(navigator, 'credentials', originalCredentials); else Reflect.deleteProperty(navigator, 'credentials');
  if (originalPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', originalPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
});

describe('WebAuthn PRF client', () => {
  it('detects unavailable APIs without starting enrollment', async () => {
    Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: undefined });
    assert.equal(passkeysAvailable(), false);
    await assert.rejects(createPasskey('Test'), /unavailable/);
  });
  it('requires verified credential use after registration, with dedicated RP and fresh challenges', async () => {
    const calls: any[] = [];
    const result = new Uint8Array(32).fill(9);
    install(async options => {
      calls.push(options.publicKey);
      return { rawId: id.buffer, getClientExtensionResults: () => ({ prf: { results: { first: result.buffer } } }) };
    }, async options => {
      calls.push(options.publicKey);
      return { rawId: id.buffer, getClientExtensionResults: () => ({ prf: { enabled: true } }) };
    });
    assert.equal(passkeysAvailable(), true);
    const credential = await createPasskey('Test');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].rp.id, PASSKEY_RP_ID);
    assert.equal(calls[0].authenticatorSelection.userVerification, 'required');
    assert.equal(calls[0].authenticatorSelection.residentKey, 'required');
    assert.equal(calls[1].rpId, PASSKEY_RP_ID);
    assert.equal(calls[1].userVerification, 'required');
    assert.notDeepEqual(calls[0].challenge, calls[1].challenge);
    assert.equal(credential.prf, arrayToBase64(new Uint8Array(32).fill(9)));
    assert.ok(result.every(n => n === 0));
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
