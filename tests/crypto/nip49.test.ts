import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { encrypt as ntEncrypt, decrypt as ntDecrypt } from 'nostr-tools/nip49';
import { ncryptsecEncode, ncryptsecDecode } from '../../src/lib/crypto/nip49.ts';
import { hexToBytes, bytesToHex } from '../../src/lib/crypto/utils.ts';
import { bech32Encode, bech32Decode, convertBits } from '../../src/lib/crypto/bech32.ts';

const TEST_PRIVKEY_HEX = '3501454135014541350145413501453fefb02227e449e57cf4d3a3ce05378683';

// Official NIP-49 test vector (https://github.com/nostr-protocol/nips/blob/master/49.md)
const SPEC_VECTOR = 'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p';
const SPEC_PASSWORD = 'nostr';

/**
 * Build a legacy (version 0x01) ncryptsec: PBKDF2-SHA256 @ 210k + AES-256-GCM.
 * Mirrors the format this extension exported before the NIP-49 v2 upgrade.
 */
async function legacyEncode(privkeyHex: string, password: string): Promise<string> {
  const privkeyBytes = hexToBytes(privkeyHex);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 210000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, privkeyBytes as BufferSource
  );

  const payload = new Uint8Array(1 + 16 + 12 + encrypted.byteLength);
  payload[0] = 0x01;
  payload.set(salt, 1);
  payload.set(iv, 17);
  payload.set(new Uint8Array(encrypted), 29);

  const data5bit = convertBits(Array.from(payload), 8, 5, true);
  return bech32Encode('ncryptsec', data5bit!);
}

describe('NIP-49 v2 (scrypt + XChaCha20-Poly1305)', () => {
  it('decrypts the official NIP-49 spec test vector', async () => {
    const decoded = await ncryptsecDecode(SPEC_VECTOR, SPEC_PASSWORD);
    assert.strictEqual(decoded, TEST_PRIVKEY_HEX);
  });

  it('encode then decode round-trips correctly', async () => {
    const encoded = await ncryptsecEncode(TEST_PRIVKEY_HEX, 'correct horse battery staple');
    assert.ok(encoded.startsWith('ncryptsec1'));
    const decoded = await ncryptsecDecode(encoded, 'correct horse battery staple');
    assert.strictEqual(decoded, TEST_PRIVKEY_HEX);
  });

  it('produces the spec v2 payload layout (91 bytes, version 0x02, log_n 16)', async () => {
    const encoded = await ncryptsecEncode(TEST_PRIVKEY_HEX, 'testpass');
    const decoded = bech32Decode(encoded);
    assert.ok(decoded);
    const payload = new Uint8Array(convertBits(decoded!.data, 5, 8, false)!);
    assert.strictEqual(payload.length, 91);
    assert.strictEqual(payload[0], 0x02); // version
    assert.strictEqual(payload[1], 16);   // log_n
    assert.strictEqual(payload[42], 0x02); // key_security_byte = unknown
  });

  it('rejects wrong password', async () => {
    const encoded = await ncryptsecEncode(TEST_PRIVKEY_HEX, 'correctpass');
    await assert.rejects(
      () => ncryptsecDecode(encoded, 'wrongpass'),
      /Wrong password/
    );
  });

  it('NFKC-normalizes the password (spec unicode test)', async () => {
    // U+212B U+2126 U+1E9B U+0323 NFKC-normalizes to U+00C5 U+03A9 U+1E69
    const denormalized = '\u212B\u2126\u1E9B\u0323';
    const normalized = '\u00C5\u03A9\u1E69';
    assert.notStrictEqual(denormalized, normalized);
    const encoded = await ncryptsecEncode(TEST_PRIVKEY_HEX, denormalized);
    const decoded = await ncryptsecDecode(encoded, normalized);
    assert.strictEqual(decoded, TEST_PRIVKEY_HEX);
  });

  it('rejects invalid private key length', async () => {
    await assert.rejects(
      () => ncryptsecEncode('abcd', 'testpass'),
      /Invalid private key length/
    );
  });

  // The export handler runs inside `vault.withPrivkey`, which owns the key bytes and
  // zeroes them. Handing those bytes straight to the encoder is the point: building a
  // hex string on the way in would leave a second copy of the key in the heap that
  // nothing can overwrite, because a string cannot be zeroed.
  it('encrypts the key given as bytes, and leaves the caller\'s array alone', async () => {
    const privkey = hexToBytes(TEST_PRIVKEY_HEX);
    const encoded = await ncryptsecEncode(privkey, 'testpass');

    assert.ok(encoded.startsWith('ncryptsec1'));
    assert.strictEqual(await ncryptsecDecode(encoded, 'testpass'), TEST_PRIVKEY_HEX,
      'bytes in must give the same key back out');
    assert.strictEqual(bytesToHex(privkey), TEST_PRIVKEY_HEX,
      'the array is borrowed: zeroing it here would blank the scope\'s key underneath it');
  });

  it('rejects a byte array that is not 32 bytes', async () => {
    await assert.rejects(
      () => ncryptsecEncode(new Uint8Array(16), 'testpass'),
      /Invalid private key length/
    );
  });

  it('rejects non-ncryptsec bech32 strings', async () => {
    await assert.rejects(
      () => ncryptsecDecode('nsec1invalid', 'testpass'),
      /Invalid ncryptsec/
    );
  });

  it('rejects unsupported version bytes', async () => {
    const payload = new Uint8Array(91);
    payload[0] = 0x03;
    const data5bit = convertBits(Array.from(payload), 8, 5, true);
    const bogus = bech32Encode('ncryptsec', data5bit!);
    await assert.rejects(
      () => ncryptsecDecode(bogus, 'testpass'),
      /Unsupported ncryptsec version/
    );
  });

  it('rejects excessive scrypt cost factors', async () => {
    const payload = new Uint8Array(91);
    payload[0] = 0x02;
    payload[1] = 30; // 2^30 — would demand gigabytes of memory
    const data5bit = convertBits(Array.from(payload), 8, 5, true);
    const bogus = bech32Encode('ncryptsec', data5bit!);
    await assert.rejects(
      () => ncryptsecDecode(bogus, 'testpass'),
      /Unsupported scrypt cost/
    );
  });
});

/**
 * Every other test in this file decodes with our own decoder, so a systematic encoder
 * error — a wrong offset, the AAD omitted, the password normalized differently — would
 * round-trip happily and pass all of them. The one spec vector only exercises decode.
 *
 * `nostr-tools` ships an independent NIP-49 implementation and is already a dependency,
 * so the other direction is cheap to check. A backup is the artefact that has to be
 * readable by software that is not this extension, years from now.
 */
describe('NIP-49 interoperability with an independent implementation', () => {
  it('writes an ncryptsec that nostr-tools can decrypt', async () => {
    const encoded = await ncryptsecEncode(TEST_PRIVKEY_HEX, 'correct horse battery staple');
    assert.strictEqual(bytesToHex(ntDecrypt(encoded, 'correct horse battery staple')), TEST_PRIVKEY_HEX);
  });

  it('reads an ncryptsec that nostr-tools wrote', async () => {
    const foreign = ntEncrypt(hexToBytes(TEST_PRIVKEY_HEX), 'hunter2', 16, 0x02);
    assert.strictEqual(await ncryptsecDecode(foreign, 'hunter2'), TEST_PRIVKEY_HEX);
  });

  it('reads every key_security_byte the spec defines', async () => {
    // 0x00 "has been handled insecurely", 0x01 "has not been", 0x02 "not tracked". The
    // byte is the AAD, so a decode that succeeds for all three proves the AAD is wired
    // from the payload rather than assumed to be the 0x02 we always write.
    for (const ksb of [0x00, 0x01, 0x02] as const) {
      const foreign = ntEncrypt(hexToBytes(TEST_PRIVKEY_HEX), 'pw', 16, ksb);
      assert.strictEqual(
        await ncryptsecDecode(foreign, 'pw'), TEST_PRIVKEY_HEX,
        `key_security_byte 0x0${ksb} must decode`
      );
    }
  });

  it('reads foreign cost factors either side of the one it writes', async () => {
    // Other clients choose their own log_n, and the decoder accepts 1..MAX_LOG_N. This
    // also exercises `scryptMaxMem` at costs the encoder never writes — the bound has to
    // be right across the whole accepted range, not just at 16.
    for (const logN of [1, 8, 14, 20]) {
      const foreign = ntEncrypt(hexToBytes(TEST_PRIVKEY_HEX), 'pw', logN, 0x02);
      assert.strictEqual(
        await ncryptsecDecode(foreign, 'pw'), TEST_PRIVKEY_HEX,
        `foreign log_n ${logN} must decode`
      );
    }
  });
});

describe('NIP-49 legacy 0x01 backward compatibility', () => {
  it('decodes legacy PBKDF2/AES-GCM ncryptsec backups', async () => {
    const legacy = await legacyEncode(TEST_PRIVKEY_HEX, 'oldbackuppass');
    const decoded = await ncryptsecDecode(legacy, 'oldbackuppass');
    assert.strictEqual(decoded, TEST_PRIVKEY_HEX);
  });

  it('rejects wrong password on legacy backups', async () => {
    const legacy = await legacyEncode(TEST_PRIVKEY_HEX, 'oldbackuppass');
    await assert.rejects(
      () => ncryptsecDecode(legacy, 'wrongpass'),
      /Wrong password/
    );
  });
});
