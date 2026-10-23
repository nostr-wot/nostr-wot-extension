/**
 * Derived-mode passkey keys against the proposal's published vectors
 * (tests/fixtures/passkey-key-mode-vectors.json, copied from nips/passkey).
 *
 * Run with:
 *   node --import tsx --test tests/crypto/passkey-derived.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bytesToHex, hexToBytes } from '../../src/lib/crypto/utils.ts';
import { deriveDerivedPasskeyKey, derivedPasskeyPubkey, derivedPrfInput, isDerivedParameterSet, isValidDerivedScalar } from '../../src/lib/crypto/passkeyDerived.ts';
import { DERIVED_PARAMETER_SETS, DERIVED_PASSKEY_APPS } from '../../src/constants/passkey.ts';
import { N } from '../../src/constants/crypto/secp256k1.ts';

const VECTORS = JSON.parse(readFileSync(new URL('../fixtures/passkey-key-mode-vectors.json', import.meta.url), 'utf8'));

describe('derived passkey parameter sets', () => {
  it('match the labels of every vector', () => {
    assert.equal(VECTORS.derived_parameter_sets.length, 2);
    for (const vector of VECTORS.derived_parameter_sets) {
      assert.ok(isDerivedParameterSet(vector.parameter_set));
      const set = DERIVED_PARAMETER_SETS[vector.parameter_set as 1 | 2];
      assert.equal(set.saltLabel, vector.salt_label);
      assert.equal(set.infoLabel, vector.info_label);
    }
  });

  for (const vector of VECTORS.derived_parameter_sets) {
    it(`derives the pinned key for parameter set 0x0${vector.parameter_set}`, () => {
      assert.equal(bytesToHex(derivedPrfInput(vector.parameter_set)), vector.prf_input);
      const prf = hexToBytes(vector.prf_output);
      const secret = deriveDerivedPasskeyKey(prf, vector.parameter_set);
      assert.equal(bytesToHex(secret), vector.secret_key);
      assert.equal(derivedPasskeyPubkey(secret), vector.public_key);
      assert.equal(bytesToHex(prf), vector.prf_output, 'the caller owns and zeroes the PRF buffer');
    });
  }

  it('pins the LaWallet vector from the task and the registry', () => {
    const secret = deriveDerivedPasskeyKey(new Uint8Array(32).fill(7), 2);
    assert.equal(bytesToHex(secret), 'a1e1ac8dd866cabdf743a4cdedbf53c680444094a25c0ffc4e558ec5a78831c1');
    assert.equal(derivedPasskeyPubkey(secret), '5146ad1f0bec6b37a9f1937c5c80d452a2d952ac1a8f4bee690dd34dbd4ef3c8');
    assert.deepEqual(DERIVED_PASSKEY_APPS.map(app => [app.rpId, app.parameterSet]), [['beta.lawallet.io', 2]]);
  });

  it('rejects unknown parameter sets and malformed PRF output instead of guessing', () => {
    for (const set of [0, 3, 0x80, '2', undefined]) assert.equal(isDerivedParameterSet(set), false);
    assert.throws(() => derivedPrfInput(3 as never), /parameter set/);
    assert.throws(() => deriveDerivedPasskeyKey(new Uint8Array(31), 1), /PRF/);
    assert.throws(() => deriveDerivedPasskeyKey(new Uint8Array(32), 9 as never), /parameter set/);
  });

  it('treats zero and out-of-range scalars as failures', () => {
    const be = (value: bigint) => hexToBytes(value.toString(16).padStart(64, '0'));
    assert.equal(isValidDerivedScalar(new Uint8Array(32)), false);
    assert.equal(isValidDerivedScalar(be(N)), false);
    assert.equal(isValidDerivedScalar(be(N + 1n)), false);
    assert.equal(isValidDerivedScalar(new Uint8Array(32).fill(0xff)), false);
    assert.equal(isValidDerivedScalar(be(N - 1n)), true);
    assert.equal(isValidDerivedScalar(be(1n)), true);
    assert.equal(isValidDerivedScalar(new Uint8Array(31).fill(1)), false);
  });
});
