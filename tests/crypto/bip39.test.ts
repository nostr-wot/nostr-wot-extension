import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { bytesToHex, hexToBytes } from '../../lib/crypto/utils.ts';
import {
  generateMnemonic, validateMnemonic, mnemonicToSeed, entropyToMnemonic
} from '../../lib/crypto/bip39.ts';

describe('generateMnemonic', () => {
  // The default must match the extension's own policy: every identity it mints is
  // 256-bit / 24 words (lib/accounts.ts), and the post-quantum handlers refuse a
  // 12-word seed as 'short-seed'. A 128-bit default was a footgun waiting for the
  // first call site that forgot to pass a strength.
  it('returns 24 words by default (256-bit)', async () => {
    const mnemonic: string = await generateMnemonic();
    const words: string[] = mnemonic.split(' ');
    assert.strictEqual(words.length, 24);
  });

  it('returns 12 words when 128-bit is asked for explicitly', async () => {
    const mnemonic: string = await generateMnemonic(128);
    assert.strictEqual(mnemonic.split(' ').length, 12);
  });

  it('returns 24 words for 256-bit strength', async () => {
    const mnemonic: string = await generateMnemonic(256);
    const words: string[] = mnemonic.split(' ');
    assert.strictEqual(words.length, 24);
  });

  it('rejects invalid strength', async () => {
    await assert.rejects(() => generateMnemonic(100), /invalid entropy/i);
    await assert.rejects(() => generateMnemonic(64), /invalid entropy/i);
  });

  it('generates valid mnemonic (checksum passes)', async () => {
    const mnemonic: string = await generateMnemonic();
    const valid: boolean = await validateMnemonic(mnemonic);
    assert.strictEqual(valid, true);
  });
});

describe('validateMnemonic', () => {
  it('accepts known valid mnemonic', async () => {
    // BIP-39 test vector: 128-bit all-zero entropy
    const mnemonic: string = await entropyToMnemonic(new Uint8Array(16));
    const valid: boolean = await validateMnemonic(mnemonic);
    assert.strictEqual(valid, true);
  });

  it('rejects invalid checksum', async () => {
    // The valid all-zero-entropy mnemonic is 11x "abandon" + "about"; replacing
    // the final word with "abandon" breaks the checksum deterministically.
    // (Previously this generated a random mnemonic and swapped the last word,
    // which flaked ~1/256 when the swap happened to keep a valid checksum.)
    const invalid: string = `${'abandon '.repeat(11)}abandon`;
    const valid: boolean = await validateMnemonic(invalid);
    assert.strictEqual(valid, false);
  });

  it('rejects wrong word count', async () => {
    assert.strictEqual(await validateMnemonic('abandon '.repeat(11).trim()), false);
    assert.strictEqual(await validateMnemonic('abandon '.repeat(13).trim()), false);
  });

  it('rejects unknown words', async () => {
    assert.strictEqual(await validateMnemonic('notaword '.repeat(12).trim()), false);
  });
});

describe('mnemonicToSeed', () => {
  it('produces 64-byte seed', async () => {
    const mnemonic: string = await generateMnemonic();
    const seed: Uint8Array = await mnemonicToSeed(mnemonic);
    assert.strictEqual(seed.length, 64);
    assert.ok(seed instanceof Uint8Array);
  });

  // BIP-39 test vector from trezor/python-mnemonic vectors.json
  // Vector: 128-bit all-zero entropy -> "abandon" x11 + "about"
  // With empty passphrase
  it('matches known BIP-39 test vector (all-zero entropy)', async () => {
    const entropy = new Uint8Array(16); // 128 bits of zeros
    const mnemonic: string = await entropyToMnemonic(entropy);
    assert.strictEqual(
      mnemonic,
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    );

    const seed: Uint8Array = await mnemonicToSeed(mnemonic);
    assert.strictEqual(
      bytesToHex(seed),
      '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4'
    );
  });

  it('matches known BIP-39 test vector with passphrase (Trezor vectors.json)', async () => {
    // Trezor python-mnemonic vectors.json: all test vectors use passphrase "TREZOR"
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const seed: Uint8Array = await mnemonicToSeed(mnemonic, 'TREZOR');
    assert.strictEqual(
      bytesToHex(seed),
      'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04'
    );
  });

  it('different passphrases produce different seeds', async () => {
    const mnemonic: string = await generateMnemonic();
    const seed1: Uint8Array = await mnemonicToSeed(mnemonic, '');
    const seed2: Uint8Array = await mnemonicToSeed(mnemonic, 'mypassword');
    assert.notDeepStrictEqual(seed1, seed2);
  });
});
