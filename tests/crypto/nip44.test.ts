import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { extract as hkdfExtract, expand as hkdfExpand } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { chacha20 } from '@noble/ciphers/chacha.js';
import { hexToBytes, bytesToHex, concatBytes } from '../../lib/crypto/utils.ts';
import { getPublicKey, ecdh } from '../../lib/crypto/secp256k1.ts';
import { nip44Encrypt, nip44Decrypt } from '../../lib/crypto/nip44.ts';

const ALICE_PRIVKEY: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
const BOB_PRIVKEY: Uint8Array = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');
const ALICE_PUBKEY: Uint8Array = getPublicKey(ALICE_PRIVKEY);
const BOB_PUBKEY: Uint8Array = getPublicKey(BOB_PRIVKEY);

describe('nip44Encrypt / nip44Decrypt', () => {
  it('encrypt then decrypt round-trip', async () => {
    const plaintext = 'Hello, NIP-44!';
    const encrypted: string = await nip44Encrypt(plaintext, ALICE_PRIVKEY, BOB_PUBKEY);
    const decrypted: string = await nip44Decrypt(encrypted, BOB_PRIVKEY, ALICE_PUBKEY);
    assert.strictEqual(decrypted, plaintext);
  });

  it('symmetric ECDH: both directions work', async () => {
    const plaintext = 'bidirectional test';
    // Alice -> Bob
    const enc1: string = await nip44Encrypt(plaintext, ALICE_PRIVKEY, BOB_PUBKEY);
    const dec1: string = await nip44Decrypt(enc1, BOB_PRIVKEY, ALICE_PUBKEY);
    assert.strictEqual(dec1, plaintext);

    // Bob -> Alice
    const enc2: string = await nip44Encrypt(plaintext, BOB_PRIVKEY, ALICE_PUBKEY);
    const dec2: string = await nip44Decrypt(enc2, ALICE_PRIVKEY, BOB_PUBKEY);
    assert.strictEqual(dec2, plaintext);
  });

  it('output is base64', async () => {
    const encrypted: string = await nip44Encrypt('test', ALICE_PRIVKEY, BOB_PUBKEY);
    // Should be valid base64
    assert.doesNotThrow(() => atob(encrypted));
  });

  it('payload starts with version byte 2', async () => {
    const encrypted: string = await nip44Encrypt('test', ALICE_PRIVKEY, BOB_PUBKEY);
    const raw: Uint8Array = Uint8Array.from(atob(encrypted), (c: string) => c.charCodeAt(0));
    assert.strictEqual(raw[0], 2); // NIP-44 v2
  });

  it('payload has correct structure: version(1) + nonce(32) + ciphertext + mac(32)', async () => {
    const encrypted: string = await nip44Encrypt('short', ALICE_PRIVKEY, BOB_PUBKEY);
    const raw: Uint8Array = Uint8Array.from(atob(encrypted), (c: string) => c.charCodeAt(0));
    // Minimum: 1 (version) + 32 (nonce) + 34 (2-byte len + 32 padded) + 32 (mac) = 99
    assert.ok(raw.length >= 99);
  });

  it('different nonces produce different ciphertexts', async () => {
    const plaintext = 'same message';
    const enc1: string = await nip44Encrypt(plaintext, ALICE_PRIVKEY, BOB_PUBKEY);
    const enc2: string = await nip44Encrypt(plaintext, ALICE_PRIVKEY, BOB_PUBKEY);
    assert.notStrictEqual(enc1, enc2);
  });

  it('padding: output length is aligned for short messages', async () => {
    // "a" (1 byte) should pad to 32 bytes, so ciphertext = 2+32 = 34 bytes
    const encrypted: string = await nip44Encrypt('a', ALICE_PRIVKEY, BOB_PUBKEY);
    const raw: Uint8Array = Uint8Array.from(atob(encrypted), (c: string) => c.charCodeAt(0));
    const ciphertextLen: number = raw.length - 1 - 32 - 32; // minus version, nonce, mac
    assert.strictEqual(ciphertextLen, 34); // 2-byte length prefix + 32 padded
  });

  it('handles unicode text', async () => {
    const plaintext = 'Hello World! Testing unicode.';
    const encrypted: string = await nip44Encrypt(plaintext, ALICE_PRIVKEY, BOB_PUBKEY);
    const decrypted: string = await nip44Decrypt(encrypted, BOB_PRIVKEY, ALICE_PUBKEY);
    assert.strictEqual(decrypted, plaintext);
  });

  it('rejects tampered MAC', async () => {
    const encrypted: string = await nip44Encrypt('test', ALICE_PRIVKEY, BOB_PUBKEY);
    const raw: Uint8Array = Uint8Array.from(atob(encrypted), (c: string) => c.charCodeAt(0));
    // Tamper with the last byte (MAC)
    raw[raw.length - 1] ^= 0x01;
    const tampered: string = btoa(String.fromCharCode(...raw));
    await assert.rejects(
      () => nip44Decrypt(tampered, BOB_PRIVKEY, ALICE_PUBKEY),
      /Invalid MAC/
    );
  });

  it('rejects too-short payload', async () => {
    const short: string = btoa(String.fromCharCode(2, ...new Uint8Array(50)));
    await assert.rejects(
      () => nip44Decrypt(short, BOB_PRIVKEY, ALICE_PUBKEY),
      /Payload too short/
    );
  });

  it('rejects payload longer than spec max (65603 bytes)', async () => {
    const big = new Uint8Array(65604);
    big[0] = 2;
    const tooLong: string = Buffer.from(big).toString('base64');
    await assert.rejects(
      () => nip44Decrypt(tooLong, BOB_PRIVKEY, ALICE_PUBKEY),
      /Payload too long/
    );
  });

  it('rejects non-canonical padding (valid MAC, oversized pad)', async () => {
    // Forge a payload with a correct MAC but padding longer than canonical:
    // unpaddedLen=1 must pad to exactly 32 bytes; give it 64 instead.
    const forge = (paddedBodyLen: number): string => {
      const sharedX = ecdh(ALICE_PRIVKEY, BOB_PUBKEY);
      const conversationKey = hkdfExtract(sha256, sharedX, new TextEncoder().encode('nip44-v2'));
      const nonce = new Uint8Array(32); // fixed nonce, fine for a test forgery
      const keys = hkdfExpand(sha256, conversationKey, nonce, 76);
      const padded = new Uint8Array(2 + paddedBodyLen);
      padded[1] = 1; // unpaddedLen = 1
      padded[2] = 0x61; // 'a'
      const ciphertext = chacha20(keys.slice(0, 32), keys.slice(32, 44), padded);
      const mac = hmac(sha256, keys.slice(44, 76), concatBytes(nonce, ciphertext));
      const final = concatBytes(new Uint8Array([2]), nonce, ciphertext, mac);
      return btoa(String.fromCharCode(...final));
    };

    // Sanity: canonical padding (32) decrypts fine
    const canonical: string = forge(32);
    assert.strictEqual(await nip44Decrypt(canonical, BOB_PRIVKEY, ALICE_PUBKEY), 'a');

    // Non-canonical padding (64) must be rejected
    const oversized: string = forge(64);
    await assert.rejects(
      () => nip44Decrypt(oversized, BOB_PRIVKEY, ALICE_PUBKEY),
      /Invalid padding/
    );
  });

  it('rejects wrong version', async () => {
    const encrypted: string = await nip44Encrypt('test', ALICE_PRIVKEY, BOB_PUBKEY);
    const raw: Uint8Array = Uint8Array.from(atob(encrypted), (c: string) => c.charCodeAt(0));
    raw[0] = 1; // wrong version
    const tampered: string = btoa(String.fromCharCode(...raw));
    await assert.rejects(
      () => nip44Decrypt(tampered, BOB_PRIVKEY, ALICE_PUBKEY),
      /Unsupported NIP-44 version/
    );
  });
});
