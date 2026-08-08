import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  derivePqKeys, kemInfo, dsaInfo, popMessage, signPop, verifyPop,
  encapsulate, decapsulate, KEM_PUBLIC_KEY_BYTES, DSA_PUBLIC_KEY_BYTES,
} from '../../lib/crypto/pq.ts';
import { mnemonicToSeed } from '../../lib/crypto/bip39.ts';
import { derivePath, NIP06_PATH } from '../../lib/crypto/bip32.ts';
import { getPublicKey } from '../../lib/crypto/secp256k1.ts';
import { bytesToHex } from '../../lib/crypto/utils.ts';

// The 24-word test mnemonic published in NIP-06.
const NIP06_MNEMONIC =
  'what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade';
// ...and the secp256k1 private key NIP-06 says it must produce.
const NIP06_PRIVKEY = 'c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add';

const b64 = (u8: Uint8Array): string => Buffer.from(u8).toString('base64');

describe('post-quantum key derivation', () => {
  it('derivation profile strings are stable', () => {
    assert.strictEqual(kemInfo(0), 'nip-pqc/v1/ml-kem-768/0');
    assert.strictEqual(dsaInfo(0), 'nip-pqc/v1/ml-dsa-65/0');
    assert.strictEqual(kemInfo(3), 'nip-pqc/v1/ml-kem-768/3');
  });

  it('the seed still produces the secp256k1 key NIP-06 publishes', async () => {
    // Guards the premise: PQ keys are siblings of THIS key, from the same seed.
    const seed = await mnemonicToSeed(NIP06_MNEMONIC);
    const privkey = await derivePath(seed, NIP06_PATH);
    assert.strictEqual(bytesToHex(privkey), NIP06_PRIVKEY);
  });

  it('produces the published test vectors', async () => {
    const seed = await mnemonicToSeed(NIP06_MNEMONIC);
    const { kem, dsa } = derivePqKeys(seed, 0);

    assert.strictEqual(kem.publicKey.length, KEM_PUBLIC_KEY_BYTES);
    assert.strictEqual(dsa.publicKey.length, DSA_PUBLIC_KEY_BYTES);

    assert.strictEqual(
      bytesToHex(sha256(kem.publicKey)),
      'fe2ffbc5611faabedc747b12f689dcafeb75f146bba4d8a678e2cbbcf2079826'
    );
    assert.strictEqual(
      bytesToHex(sha256(dsa.publicKey)),
      'b0a39a12ce1de3341de4f148a774ec50d004c49b20c2054e9238922f951331c3'
    );
  });

  it('is deterministic — the same mnemonic always restores the same keys', async () => {
    const a = derivePqKeys(await mnemonicToSeed(NIP06_MNEMONIC), 0);
    const b = derivePqKeys(await mnemonicToSeed(NIP06_MNEMONIC), 0);
    assert.deepStrictEqual(a.kem.publicKey, b.kem.publicKey);
    assert.deepStrictEqual(a.dsa.publicKey, b.dsa.publicKey);
  });

  it('different account indices produce different keys', async () => {
    const seed = await mnemonicToSeed(NIP06_MNEMONIC);
    const a = derivePqKeys(seed, 0);
    const b = derivePqKeys(seed, 1);
    assert.notDeepStrictEqual(a.kem.publicKey, b.kem.publicKey);
    assert.notDeepStrictEqual(a.dsa.publicKey, b.dsa.publicKey);
  });

  it('the KEM and DSA seeds are independent of each other', async () => {
    const seed = await mnemonicToSeed(NIP06_MNEMONIC);
    const { kem, dsa } = derivePqKeys(seed, 0);
    // Different algorithms, different sizes — but assert no accidental shared prefix.
    assert.notDeepStrictEqual(kem.publicKey.slice(0, 32), dsa.publicKey.slice(0, 32));
  });

  it('rejects an invalid seed', () => {
    assert.throws(() => derivePqKeys(new Uint8Array(0), 0), /Invalid seed/);
    assert.throws(() => derivePqKeys(null as unknown as Uint8Array, 0), /Invalid seed/);
  });

  it('rejects an invalid account index', async () => {
    const seed = await mnemonicToSeed(NIP06_MNEMONIC);
    assert.throws(() => derivePqKeys(seed, -1), /Invalid account index/);
    assert.throws(() => derivePqKeys(seed, 1.5), /Invalid account index/);
  });
});

describe('post-quantum key derivation — independence from the secp256k1 key', () => {
  it('the secp256k1 private key is not an input, so it cannot regenerate the PQ keys', async () => {
    // This is the property the whole scheme rests on. If someone ever refactors
    // derivePqKeys to take the private key, this test is the thing that should
    // stop them: the 32-byte privkey must not be usable as the seed.
    const seed = await mnemonicToSeed(NIP06_MNEMONIC);
    const privkey = await derivePath(seed, NIP06_PATH);

    const fromSeed = derivePqKeys(seed, 0);
    const fromPrivkey = derivePqKeys(privkey, 0);

    assert.notDeepStrictEqual(
      fromSeed.kem.publicKey,
      fromPrivkey.kem.publicKey,
      'PQ keys derived from the privkey must not match those derived from the seed'
    );
  });
});

describe('proof of possession', () => {
  it('verifies against the published ML-DSA key', async () => {
    const seed = await mnemonicToSeed(NIP06_MNEMONIC);
    const { kem, dsa } = derivePqKeys(seed, 0);
    const privkey = await derivePath(seed, NIP06_PATH);
    const pubkeyHex = bytesToHex(getPublicKey(privkey));

    const msg = popMessage(pubkeyHex, b64(kem.publicKey), b64(dsa.publicKey));
    const sig = signPop(msg, dsa.secretKey);

    assert.ok(verifyPop(sig, msg, dsa.publicKey));
  });

  it('rejects a signature made by a different key', async () => {
    const seed = await mnemonicToSeed(NIP06_MNEMONIC);
    const mine = derivePqKeys(seed, 0);
    const attacker = derivePqKeys(seed, 99);
    const msg = popMessage('00'.repeat(32), b64(mine.kem.publicKey), b64(mine.dsa.publicKey));

    const forged = signPop(msg, attacker.dsa.secretKey);
    assert.strictEqual(verifyPop(forged, msg, mine.dsa.publicKey), false);
  });

  it('substituting the KEM key invalidates the proof', async () => {
    const seed = await mnemonicToSeed(NIP06_MNEMONIC);
    const mine = derivePqKeys(seed, 0);
    const other = derivePqKeys(seed, 1);

    const realMsg = popMessage('11'.repeat(32), b64(mine.kem.publicKey), b64(mine.dsa.publicKey));
    const sig = signPop(realMsg, mine.dsa.secretKey);

    const tampered = popMessage('11'.repeat(32), b64(other.kem.publicKey), b64(mine.dsa.publicKey));
    assert.strictEqual(verifyPop(sig, tampered, mine.dsa.publicKey), false);
  });

  it('substituting the npub invalidates the proof', async () => {
    const seed = await mnemonicToSeed(NIP06_MNEMONIC);
    const { kem, dsa } = derivePqKeys(seed, 0);

    const realMsg = popMessage('11'.repeat(32), b64(kem.publicKey), b64(dsa.publicKey));
    const sig = signPop(realMsg, dsa.secretKey);

    const tampered = popMessage('22'.repeat(32), b64(kem.publicKey), b64(dsa.publicKey));
    assert.strictEqual(verifyPop(sig, tampered, dsa.publicKey), false);
  });

  it('garbage signatures are rejected without throwing', async () => {
    const seed = await mnemonicToSeed(NIP06_MNEMONIC);
    const { kem, dsa } = derivePqKeys(seed, 0);
    const msg = popMessage('33'.repeat(32), b64(kem.publicKey), b64(dsa.publicKey));
    assert.strictEqual(verifyPop(new Uint8Array(10), msg, dsa.publicKey), false);
  });
});

describe('ML-KEM encapsulation', () => {
  it('round-trips a shared secret', async () => {
    const seed = await mnemonicToSeed(NIP06_MNEMONIC);
    const { kem } = derivePqKeys(seed, 0);

    const { cipherText, sharedSecret } = encapsulate(kem.publicKey);
    const recovered = decapsulate(cipherText, kem.secretKey);

    assert.deepStrictEqual(recovered, sharedSecret);
    assert.strictEqual(sharedSecret.length, 32);
  });

  it('a different recipient key does not recover the secret', async () => {
    const seed = await mnemonicToSeed(NIP06_MNEMONIC);
    const mine = derivePqKeys(seed, 0);
    const other = derivePqKeys(seed, 1);

    const { cipherText, sharedSecret } = encapsulate(mine.kem.publicKey);
    // ML-KEM is designed to return a pseudo-random secret rather than fail.
    const wrong = decapsulate(cipherText, other.kem.secretKey);
    assert.notDeepStrictEqual(wrong, sharedSecret);
  });

  it('rejects a malformed public key length', () => {
    assert.throws(() => encapsulate(new Uint8Array(100)), /Invalid ML-KEM public key length/);
  });
});
