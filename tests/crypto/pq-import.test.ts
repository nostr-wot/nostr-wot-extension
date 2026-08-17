/**
 * Post-quantum keyfile import — parsing and pair validation.
 *
 * The keyfile carries SECRET key material for an account that cannot derive its own,
 * so every field is attacker-supplied until proven otherwise. Length checks alone
 * would accept a truncated paste that happens to land on the right byte count for a
 * different field, or a public key paired with somebody else's secret. Both pairs
 * therefore have to prove themselves by round trip before anything is stored.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { derivePqKeys, parsePqKeyfile, PQ_PROFILE, ALG_KEM, ALG_DSA } from '../../lib/crypto/pq.ts';
import { arrayToBase64 } from '../../lib/crypto/utils.ts';

const seedA = new Uint8Array(64).fill(7);
const seedB = new Uint8Array(64).fill(9);

function keyfileFor(seed: Uint8Array): Record<string, unknown> {
  const { kem, dsa } = derivePqKeys(seed, 0);
  return {
    v: PQ_PROFILE,
    origin: 'independent',
    alg: { kem: ALG_KEM, dsa: ALG_DSA },
    kem: { public: arrayToBase64(kem.publicKey), secret: arrayToBase64(kem.secretKey) },
    dsa: { public: arrayToBase64(dsa.publicKey), secret: arrayToBase64(dsa.secretKey) },
  };
}

const valid = () => JSON.stringify(keyfileFor(seedA));

describe('parsePqKeyfile — accepts a well-formed keyfile', () => {
  it('returns both key pairs', () => {
    const keys = parsePqKeyfile(valid());
    assert.strictEqual(keys.kem.publicKey.length, 1568);
    assert.strictEqual(keys.kem.secretKey.length, 3168);
    assert.strictEqual(keys.dsa.publicKey.length, 2592);
    assert.strictEqual(keys.dsa.secretKey.length, 4896);
  });

  it('tolerates surrounding whitespace from a paste', () => {
    assert.ok(parsePqKeyfile(`\n  ${valid()}  \n`));
  });

  it('round-trips the exact bytes the generator produced', () => {
    const { kem } = derivePqKeys(seedA, 0);
    const parsed = parsePqKeyfile(valid());
    assert.deepStrictEqual(parsed.kem.publicKey, kem.publicKey);
    assert.deepStrictEqual(parsed.kem.secretKey, kem.secretKey);
  });
});

describe('parsePqKeyfile — rejects malformed input', () => {
  const bad = (mutate: (o: any) => void, pattern: RegExp) => {
    const obj = keyfileFor(seedA);
    mutate(obj);
    assert.throws(() => parsePqKeyfile(JSON.stringify(obj)), pattern);
  };

  it('rejects non-JSON', () => {
    assert.throws(() => parsePqKeyfile('not json at all'), /not a valid key file/i);
  });

  it('rejects an empty string', () => {
    assert.throws(() => parsePqKeyfile('   '), /not a valid key file/i);
  });

  it('rejects a JSON array', () => {
    assert.throws(() => parsePqKeyfile('[1,2,3]'), /not a valid key file/i);
  });

  it('rejects an unknown profile version', () => {
    bad(o => { o.v = 'nip-pqc/v99'; }, /unsupported key file version/i);
  });

  it('rejects an unknown KEM algorithm', () => {
    bad(o => { o.alg.kem = 'ml-kem-512'; }, /ml-kem-1024/i);
  });

  it('rejects an unknown signature algorithm', () => {
    bad(o => { o.alg.dsa = 'ml-dsa-44'; }, /ml-dsa-87/i);
  });

  it('rejects a missing section', () => {
    bad(o => { delete o.kem; }, /missing/i);
  });

  it('rejects a non-base64 field', () => {
    bad(o => { o.kem.secret = 'not base64!!!'; }, /could not be decoded|invalid/i);
  });

  it('rejects a truncated secret key', () => {
    bad(o => { o.kem.secret = o.kem.secret.slice(0, 100); }, /ml-kem-1024 secret key/i);
  });

  it('rejects a truncated public key', () => {
    bad(o => { o.dsa.public = o.dsa.public.slice(0, 100); }, /ml-dsa-87 public key/i);
  });
});

describe('parsePqKeyfile — rejects mismatched pairs', () => {
  it('rejects a KEM public key that does not match its secret', () => {
    const a = keyfileFor(seedA) as any;
    const b = keyfileFor(seedB) as any;
    a.kem.public = b.kem.public;
    assert.throws(() => parsePqKeyfile(JSON.stringify(a)), /ml-kem-1024 keys do not match/i);
  });

  it('rejects a DSA public key that does not match its secret', () => {
    const a = keyfileFor(seedA) as any;
    const b = keyfileFor(seedB) as any;
    a.dsa.public = b.dsa.public;
    assert.throws(() => parsePqKeyfile(JSON.stringify(a)), /ml-dsa-87 keys do not match/i);
  });

  it('rejects a secret whose bytes were corrupted but whose length is right', () => {
    const obj = keyfileFor(seedA) as any;
    const bytes = Buffer.from(obj.kem.secret, 'base64');
    bytes[0] ^= 0xff;
    bytes[1] ^= 0xff;
    obj.kem.secret = bytes.toString('base64');
    assert.throws(() => parsePqKeyfile(JSON.stringify(obj)), /ml-kem-1024 keys do not match/i);
  });
});
