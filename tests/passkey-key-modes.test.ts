/**
 * Passkey handle classification and the derived-import decision, against every
 * handle case in tests/fixtures/passkey-key-mode-vectors.json.
 *
 * Run with:
 *   node --import tsx --test tests/passkey-key-modes.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bytesToHex, hexToBytes } from '../src/lib/crypto/utils.ts';
import { classifyPasskeyHandle, decideDerivedImport, isKnownDerivedHost, normalizeExternalPasskeyHost } from '../src/domain/vault/passkeyKeyModes.ts';

const VECTORS = JSON.parse(readFileSync(new URL('./fixtures/passkey-key-mode-vectors.json', import.meta.url), 'utf8'));
const handle = (hex: string | null) => hex === null ? null : hexToBytes(hex);

describe('passkey handle classification', () => {
  for (const vector of VECTORS.handles) {
    it(vector.description, () => {
      const result = classifyPasskeyHandle(handle(vector.handle));
      assert.equal(result.mode, vector.expect.mode);
      if (result.mode === 'derived') assert.equal(result.parameterSet, vector.expect.parameter_set);
      if (result.mode === 'stored') {
        assert.equal(result.legacy, vector.expect.legacy);
        assert.equal(result.author ? bytesToHex(result.author) : undefined, vector.expect.author);
      }
    });
  }

  it('treats an empty handle as unknown and a 36-byte LaWallet UUID as unknown', () => {
    assert.equal(classifyPasskeyHandle(new Uint8Array()).mode, 'unknown');
    assert.equal(classifyPasskeyHandle(undefined).mode, 'unknown');
    assert.equal(classifyPasskeyHandle(new TextEncoder().encode('3f2b8c1e-9d4a-4e7b-b5c2-1a6f0e8d7c94')).mode, 'unknown');
  });
});

describe('derived import decision', () => {
  const derived2 = classifyPasskeyHandle(handle('4e504b010102ffeeddccbbaa99887766554433221100'));
  const derived1 = classifyPasskeyHandle(handle('4e504b01010100112233445566778899aabbccddeeff'));
  const uuid = classifyPasskeyHandle(new TextEncoder().encode('3f2b8c1e-9d4a-4e7b-b5c2-1a6f0e8d7c94'));

  it('derives a tagged handle with the expected set, wherever it comes from', () => {
    assert.deepEqual(decideDerivedImport(derived2, 2, true), { action: 'derive', confidence: 'derived' });
    assert.deepEqual(decideDerivedImport(derived2, 2, false), { action: 'derive', confidence: 'derived' });
  });

  it('derives an untagged handle as derived only on a host configured for the set', () => {
    assert.deepEqual(decideDerivedImport(uuid, 2, true), { action: 'derive', confidence: 'derived' });
    assert.deepEqual(decideDerivedImport(uuid, 2, false), { action: 'refuse', reason: 'unsupported' });
    assert.deepEqual(decideDerivedImport({ mode: 'unknown' }, 1, false), { action: 'refuse', reason: 'unsupported' });
  });

  it('refuses stored, legacy stored, unsupported and other-set handles', () => {
    assert.deepEqual(decideDerivedImport(derived1, 2, true), { action: 'refuse', reason: 'parameter-set', parameterSet: 1 });
    assert.deepEqual(decideDerivedImport(classifyPasskeyHandle(handle('4e504b01010500000000000000000000000000000000')), 2, true), { action: 'refuse', reason: 'parameter-set', parameterSet: 5 });
    for (const vector of VECTORS.handles.filter((item: any) => item.expect.mode === 'stored' || item.expect.mode === 'unsupported')) {
      const decision = decideDerivedImport(classifyPasskeyHandle(handle(vector.handle)), 2, true);
      assert.equal(decision.action, 'refuse', vector.description);
      assert.equal(decision.action === 'refuse' && decision.reason, vector.expect.mode);
    }
  });

  it('knows LaWallet only under its own host and set', () => {
    assert.equal(isKnownDerivedHost('beta.lawallet.io', 2), true);
    assert.equal(isKnownDerivedHost('beta.lawallet.io', 1), false);
    assert.equal(isKnownDerivedHost('lawallet.io', 2), false);
  });
});

describe('external passkey host input', () => {
  it('accepts a bare host or an https origin', () => {
    assert.equal(normalizeExternalPasskeyHost(' Beta.LaWallet.io '), 'beta.lawallet.io');
    assert.equal(normalizeExternalPasskeyHost('https://wallet.example.com/'), 'wallet.example.com');
  });
  it('rejects schemes, ports, paths, single labels and Nostr WoT RPs', () => {
    for (const input of ['http://example.com', 'example.com:8443', 'https://example.com/login', 'localhost', 'user@example.com', '', 'passkeys.nostrwot.com', 'https://passkeys.nostr-wot.com']) {
      assert.equal(normalizeExternalPasskeyHost(input), null, input);
    }
  });
});
