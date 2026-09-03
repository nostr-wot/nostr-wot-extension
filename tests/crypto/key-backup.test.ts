/**
 * A backup file has to be readable again.
 *
 * This encryption lived inline in the seed-export modal, where nothing verified
 * that what it wrote could ever be decrypted — in an extension whose whole job
 * is custody, producing the last copy of something the user cannot reconstruct.
 * The round trip is the point of this file.
 *
 * Run with:
 *   node --import tsx --test tests/crypto/key-backup.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encryptBackup, decryptBackup } from '../../lib/crypto/keyBackup.ts';

const SEED = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct horse battery staple';

describe('keyBackup', () => {
  it('decrypts what it encrypted', async () => {
    const file = await encryptBackup(SEED, PASSWORD);
    assert.equal(await decryptBackup(file, PASSWORD), SEED);
  });

  it('writes the documented envelope', async () => {
    const parsed = JSON.parse(await encryptBackup(SEED, PASSWORD));
    assert.deepEqual(Object.keys(parsed).sort(), ['ct', 'iv', 'salt', 'v']);
    assert.equal(parsed.v, 1);
    for (const field of ['salt', 'iv', 'ct'] as const) {
      assert.match(parsed[field], /^[A-Za-z0-9+/]+=*$/, `${field} should be base64`);
    }
  });

  it('refuses the wrong password rather than returning rubbish', async () => {
    // AES-GCM authenticates, so a wrong key fails the tag instead of decrypting
    // to garbage the caller might write over the real backup.
    const file = await encryptBackup(SEED, PASSWORD);
    await assert.rejects(decryptBackup(file, 'not the password'), /Wrong password/);
  });

  it('produces a different file every time for the same input', async () => {
    // Fresh salt and IV per call: two backups of one seed must not be visibly
    // the same file.
    const a = await encryptBackup(SEED, PASSWORD);
    const b = await encryptBackup(SEED, PASSWORD);
    assert.notEqual(a, b);
    assert.equal(await decryptBackup(a, PASSWORD), await decryptBackup(b, PASSWORD));
  });

  it('round-trips a post-quantum key file, not just a seed phrase', async () => {
    // The second caller. These are kilobytes of base64 rather than twelve words.
    const keyfile = JSON.stringify({
      profile: 'ml-kem-1024+ml-dsa-87',
      kem: { public: 'A'.repeat(2100), secret: 'B'.repeat(4600) },
      dsa: { public: 'C'.repeat(3500), secret: 'D'.repeat(6500) },
    });
    const file = await encryptBackup(keyfile, PASSWORD);
    assert.equal(await decryptBackup(file, PASSWORD), keyfile);
  });

  it('round-trips non-ASCII', async () => {
    const value = 'sémille — 種子 — семя 🔐';
    assert.equal(await decryptBackup(await encryptBackup(value, PASSWORD), PASSWORD), value);
  });

  it('rejects a file that is not a backup', async () => {
    await assert.rejects(decryptBackup('{}', PASSWORD), /Not a backup file/);
    await assert.rejects(decryptBackup('not json at all', PASSWORD), /Not a backup file/);
    await assert.rejects(
      decryptBackup(JSON.stringify({ v: 2, salt: 'x', iv: 'y', ct: 'z' }), PASSWORD),
      /Not a backup file/,
    );
  });
});
