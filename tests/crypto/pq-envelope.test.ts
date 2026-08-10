import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from '@noble/hashes/utils.js';
import { derivePqKeys, pqEncrypt, pqDecrypt, isPqEnvelope } from '../../lib/crypto/pq.ts';
import { arrayToBase64, base64ToArray } from '../../lib/crypto/utils.ts';

const ALICE = 'aa'.repeat(32);
const BOB = 'bb'.repeat(32);
const conv = (fill = 7) => new Uint8Array(32).fill(fill);
const bob = () => derivePqKeys(randomBytes(64), 0);

describe('post-quantum envelope', () => {
  it('round-trips', () => {
    const b = bob();
    const ct = pqEncrypt('hello', b.kem.publicKey, conv(), ALICE, BOB);
    assert.strictEqual(pqDecrypt(ct, b.kem.secretKey, conv(), ALICE, BOB), 'hello');
  });

  it('is recognisable without being told', () => {
    const b = bob();
    assert.ok(isPqEnvelope(pqEncrypt('hi', b.kem.publicKey, conv(), ALICE, BOB)));
  });

  it('does not mistake a classic NIP-44 payload for one of ours', () => {
    // This is what makes polymorphic decrypt safe: a false positive here would send
    // ordinary traffic down the post-quantum path and fail every existing message.
    assert.strictEqual(isPqEnvelope('AjXk9k1jqCq0nWyGUvUbXQ=='), false);
    assert.strictEqual(isPqEnvelope('not base64 at all !!!'), false);
    assert.strictEqual(isPqEnvelope(''), false);
    assert.strictEqual(isPqEnvelope(arrayToBase64(new Uint8Array([2, 1, 3]))), false);
  });

  it('both halves of the hybrid are load-bearing', () => {
    const b = bob();
    const other = bob();
    const ct = pqEncrypt('hybrid', b.kem.publicKey, conv(7), ALICE, BOB);
    assert.throws(() => pqDecrypt(ct, b.kem.secretKey, conv(8), ALICE, BOB), /Decryption failed/);
    assert.throws(() => pqDecrypt(ct, other.kem.secretKey, conv(7), ALICE, BOB), /Decryption failed/);
  });

  it('rejects replay into another conversation', () => {
    const b = bob();
    const ct = pqEncrypt('for bob', b.kem.publicKey, conv(), ALICE, BOB);
    assert.throws(() => pqDecrypt(ct, b.kem.secretKey, conv(), 'cc'.repeat(32), BOB), /Decryption failed/);
  });

  it('rejects tampering and downgrade', () => {
    const b = bob();
    const ct = pqEncrypt('secret', b.kem.publicKey, conv(), ALICE, BOB);
    const flip = (i: number) => {
      const bytes = base64ToArray(ct);
      bytes[i] = bytes[i]! ^ 0xff;
      return arrayToBase64(bytes);
    };
    assert.throws(() => pqDecrypt(flip(1), b.kem.secretKey, conv(), ALICE, BOB), /Decryption failed/);
    assert.throws(() => pqDecrypt(flip(50), b.kem.secretKey, conv(), ALICE, BOB), /Decryption failed/);
  });

  it('padding hides message length', () => {
    const b = bob();
    const sizes = ['a', 'ab', 'a'.repeat(30)].map(
      m => pqEncrypt(m, b.kem.publicKey, conv(), ALICE, BOB).length,
    );
    assert.strictEqual(new Set(sizes).size, 1);
  });
});
