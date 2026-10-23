import { detectRecoveryBackup } from '../src/domain/vault/recoveryBackup.ts';
/**
 * Importing a derived-mode passkey created by another app, with WebAuthn mocked.
 *
 * Run with:
 *   node --import tsx --import ./tests/helpers/register-mocks.ts --test tests/derived-passkey-import.test.ts
 */
import browser from './helpers/browser-mock.ts';
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bytesToHex, hexToBytes } from '../src/lib/crypto/utils.ts';
import { npubEncode } from '../src/lib/crypto/bech32.ts';
import { readNosskeyPasskey, readDerivedPasskey, clearDerivedPasskey, derivedPasskeySecretHex, DerivedPasskeyRefusedError } from '../src/services/vault/derivedPasskeyImport.ts';
import { assertPasskeyPrf, PRF_UNAVAILABLE_MESSAGE } from '../src/services/vault/passkeyClient.ts';

const VECTORS = JSON.parse(readFileSync(new URL('./fixtures/passkey-key-mode-vectors.json', import.meta.url), 'utf8'));
const LAWALLET = VECTORS.derived_parameter_sets.find((item: any) => item.parameter_set === 2);
const UUID_HANDLE = new TextEncoder().encode('3f2b8c1e-9d4a-4e7b-b5c2-1a6f0e8d7c94');
const RAW_ID = new Uint8Array([7, 7, 7]);

const originalCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials');
const originalPublicKey = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
afterEach(() => {
  if (originalCredentials) Object.defineProperty(navigator, 'credentials', originalCredentials); else Reflect.deleteProperty(navigator, 'credentials');
  if (originalPublicKey) Object.defineProperty(globalThis, 'PublicKeyCredential', originalPublicKey); else Reflect.deleteProperty(globalThis, 'PublicKeyCredential');
});

interface Reply { handle?: Uint8Array | null; prf?: Uint8Array | null; rawId?: Uint8Array }
/** Install a WebAuthn mock answering each get() with the next reply; returns the requests and PRF buffers. */
function install(...replies: Reply[]) {
  const requests: any[] = [];
  const outputs: Uint8Array[] = [];
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
    create: async () => assert.fail('import must never create a credential'),
    get: async ({ publicKey }: any) => {
      requests.push(publicKey);
      const reply = replies[requests.length - 1];
      if (!reply) return assert.fail('unexpected extra assertion');
      const output = reply.prf ? reply.prf.slice() : null;
      if (output) outputs.push(output);
      return {
        rawId: (reply.rawId ?? RAW_ID).slice().buffer,
        response: { userHandle: reply.handle === undefined ? UUID_HANDLE.slice().buffer : reply.handle?.slice().buffer ?? null },
        getClientExtensionResults: () => (output ? { prf: { results: { first: output.buffer } } } : {}),
      };
    },
  } });
  return { requests, outputs };
}
const sevens = () => new Uint8Array(32).fill(7);

function grants(context: any) {
  const requested: any[] = [];
  context.mock.method(browser.permissions, 'request', async (arg: any) => { requested.push(arg); return true; });
  return requested;
}

describe('reading a derived passkey from another app', () => {
  it('derives the LaWallet vector from an untagged UUID handle on its registry host', async context => {
    const requested = grants(context);
    const { requests, outputs } = install({ prf: sevens() });
    const candidate = await readDerivedPasskey('beta.lawallet.io', 2);
    assert.equal(bytesToHex(candidate.secret), LAWALLET.secret_key);
    assert.equal(candidate.pubkey, LAWALLET.public_key);
    assert.equal(candidate.npub, npubEncode(LAWALLET.public_key));
    assert.equal(candidate.confidence, 'derived');
    assert.equal(candidate.rpId, 'beta.lawallet.io');
    assert.deepEqual(requested, [{ origins: ['https://beta.lawallet.io/*'] }], 'permission for exactly the chosen origin');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].rpId, 'beta.lawallet.io');
    assert.equal(requests[0].userVerification, 'required');
    assert.equal(requests[0].allowCredentials, undefined, 'discoverable assertion');
    assert.equal(bytesToHex(new Uint8Array(requests[0].extensions.prf.eval.first)), LAWALLET.prf_input);
    assert.equal(requests[0].extensions.prf.eval.second, undefined, 'the stored-mode input is not requested');
    assert.equal(requests[0].extensions.largeBlob, undefined);
    assert.ok(outputs[0].every(byte => byte === 0), 'browser PRF output is zeroed');
    assert.equal(derivedPasskeySecretHex(candidate), LAWALLET.secret_key);
    clearDerivedPasskey(candidate);
    assert.ok(candidate.secret.every(byte => byte === 0), 'secret is zeroed on clear');
    assert.throws(() => derivedPasskeySecretHex(candidate), /wizard.importFailed/);
  });

  it('derives a tagged 0x02 handle and refuses an unidentified custom passkey', async context => {
    grants(context);
    install({ handle: hexToBytes('4e504b010102ffeeddccbbaa99887766554433221100'), prf: sevens() });
    const tagged = await readDerivedPasskey('https://wallet.example.org/', 2);
    assert.equal(tagged.confidence, 'derived');
    assert.equal(tagged.pubkey, LAWALLET.public_key);
    clearDerivedPasskey(tagged);
    install({ handle: null, prf: sevens() });
    await assert.rejects(readDerivedPasskey('wallet.example.org', 1));
  });

  it('refuses stored, legacy, unsupported and other-set passkeys without deriving', async context => {
    grants(context);
    const cases: Array<[string, string]> = [
      ['4e504b010279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'stored'],
      ['79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'stored'],
      [`4e504b${'11'.repeat(29)}`, 'stored'],
      [`03${'ab'.repeat(32)}`, 'stored'],
      ['4e504b02010000000000000000000000000000000000', 'unsupported'],
      ['4e504b010101000000000000000000000000000000', 'unsupported'],
      ['4e504b01010100112233445566778899aabbccddeeff', 'parameter-set'],
    ];
    for (const [hex, reason] of cases) {
      const { requests, outputs } = install({ handle: hexToBytes(hex), prf: sevens() });
      await assert.rejects(readDerivedPasskey('beta.lawallet.io', 2), (error: unknown) => {
        assert.ok(error instanceof DerivedPasskeyRefusedError, hex);
        assert.equal(error.reason, reason);
        return true;
      });
      assert.equal(requests.length, 1, 'no second request after a refusal');
      assert.ok(outputs[0].every(byte => byte === 0), 'PRF output zeroed after refusal');
    }
  });

  it('retries once against the selected credential when PRF is missing, then reports PRF unavailable', async context => {
    grants(context);
    const recovered = install({ prf: null }, { prf: sevens() });
    const candidate = await readDerivedPasskey('beta.lawallet.io', 2);
    assert.equal(candidate.pubkey, LAWALLET.public_key);
    assert.equal(recovered.requests.length, 2);
    assert.deepEqual([...new Uint8Array(recovered.requests[1].allowCredentials[0].id)], [...RAW_ID]);
    assert.equal(bytesToHex(new Uint8Array(recovered.requests[1].extensions.prf.eval.first)), LAWALLET.prf_input);
    assert.ok(recovered.outputs[0].every(byte => byte === 0));
    clearDerivedPasskey(candidate);

    const missing = install({ prf: null }, { prf: null });
    await assert.rejects(readDerivedPasskey('beta.lawallet.io', 2), new RegExp(PRF_UNAVAILABLE_MESSAGE.replace(/[().]/g, '\\$&')));
    assert.equal(missing.requests.length, 2);

    install({ prf: null }, { prf: sevens(), rawId: new Uint8Array([9]) });
    await assert.rejects(readDerivedPasskey('beta.lawallet.io', 2), /passkey.cancelled/);
  });

  it('rejects malformed hosts and Nostr WoT RPs before asking for any permission', async context => {
    const requested = grants(context);
    const { requests } = install();
    for (const host of ['http://beta.lawallet.io', 'beta.lawallet.io/login', 'localhost', 'passkeys.nostrwot.com']) {
      await assert.rejects(readDerivedPasskey(host, 2), /passkeyImport.invalidHost/);
    }
    await assert.rejects(readDerivedPasskey('beta.lawallet.io', 7 as never), /passkeyImport.refusedUnsupported/);
    assert.equal(requested.length, 0);
    assert.equal(requests.length, 0);
  });

  it('stops when the host permission is denied', async context => {
    context.mock.method(browser.permissions, 'request', async () => false);
    const { requests } = install();
    await assert.rejects(readDerivedPasskey('beta.lawallet.io', 2), /not granted/);
    assert.equal(requests.length, 0);
  });

  it('maps a cancelled browser prompt to the shared retry message', async context => {
    grants(context);
    Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create: async () => null, get: async () => { throw new DOMException('x', 'NotAllowedError'); } } });
    await assert.rejects(readDerivedPasskey('beta.lawallet.io', 2), /passkey.cancelled/);
  });
});

describe('assertPasskeyPrf', () => {
  it('copies a 32-byte PRF result, zeroes the browser buffer and discards malformed output', async () => {
    const { outputs } = install({ prf: sevens(), handle: null }, { prf: new Uint8Array(16).fill(5) });
    const input = new Uint8Array(32).fill(1);
    const first = await assertPasskeyPrf('example.com', input);
    assert.deepEqual([...first.prf!], [...sevens()]);
    assert.equal(first.userHandle, null);
    assert.ok(outputs[0].every(byte => byte === 0));
    const second = await assertPasskeyPrf('example.com', input, RAW_ID);
    assert.equal(second.prf, null);
    assert.ok(outputs[1].every(byte => byte === 0));
    await assert.rejects(assertPasskeyPrf('example', input), /Invalid passkey domain/);
    await assert.rejects(assertPasskeyPrf('example.com', new Uint8Array(0)), /Invalid passkey domain/);
  });
});


describe('Nosskey backup import', () => {
  it('pins the backup credential, preserves the raw-PRF key and clears outputs', async context => {
    grants(context);
    const { getPublicKey } = await import('nostr-tools');
    const backup = JSON.stringify({credentialId:'070707',pubkey:getPublicKey(sevens()),salt:'6e6f7374722d70776b'});
    const {requests,outputs} = install({prf:sevens()});
    assert.equal(detectRecoveryBackup(backup), 'account');
    const result = await readNosskeyPasskey('nosskey.app',backup);
    assert.equal(result.pubkey,getPublicKey(sevens()));
    assert.equal(bytesToHex(result.secret),'07'.repeat(32));
    assert.deepEqual(new Uint8Array(requests[0].allowCredentials[0].id),RAW_ID);
    assert.equal(new TextDecoder().decode(requests[0].extensions.prf.eval.first),'nostr-pwk');
    assert.ok(outputs[0].every(byte=>byte===0));
    clearDerivedPasskey(result);
  });
  it('refuses a different credential and never retries as derived', async context => {
    grants(context);
    const { getPublicKey } = await import('nostr-tools');
    const backup=JSON.stringify({credentialId:'070707',pubkey:getPublicKey(sevens()),salt:'6e6f7374722d70776b'});
    const {requests,outputs}=install({prf:sevens(),rawId:new Uint8Array([8])});
    await assert.rejects(readNosskeyPasskey('nosskey.app',backup));
    assert.equal(requests.length,1);
    assert.ok(outputs[0].every(byte=>byte===0));
  });
});


it('automatically selects the tagged format and pins the second assertion', async context => {
  grants(context);
  const handle = hexToBytes('4e504b010102ffeeddccbbaa99887766554433221100');
  const { requests } = install({ handle, prf: sevens() }, { handle, prf: sevens() });
  const candidate = await readDerivedPasskey('wallet.example.org');
  assert.equal(candidate.pubkey, LAWALLET.public_key);
  assert.equal(candidate.parameterSet, 2);
  assert.deepEqual(new Uint8Array(requests[1].allowCredentials[0].id), RAW_ID);
  clearDerivedPasskey(candidate);
});
it('automatically uses the known app format for old untagged passkeys', async context => {
  grants(context); const {requests}=install({prf:sevens()});
  const candidate=await readDerivedPasskey('beta.lawallet.io');
  assert.equal(candidate.pubkey, LAWALLET.public_key); assert.equal(requests.length,1);clearDerivedPasskey(candidate);
});
