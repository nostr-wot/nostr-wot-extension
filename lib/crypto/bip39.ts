/**
 * BIP-39 — Mnemonic Seed Phrase Generation and Seed Derivation
 *
 * Thin wrapper over @scure/bip39. Keeps async signatures for backward compatibility.
 *
 * @see https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki — BIP-39
 *
 * @module lib/crypto/bip39
 */

import {
  generateMnemonic as _gen,
  mnemonicToSeedSync as _seedSync,
  validateMnemonic as _validate,
  entropyToMnemonic as _etm
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

/**
 * Generate a BIP-39 mnemonic.
 *
 * Defaults to 256 bits (24 words) rather than the BIP-39 minimum, because that is the
 * policy the rest of the extension enforces: `generateNewAccount()` mints 256-bit
 * identities, and the post-quantum handlers reject a 12-word seed as 'short-seed' since
 * 128 bits would become the weakest link. A 128-bit default only ever meant the next
 * caller who forgot the argument would silently get the weaker key.
 *
 * @param strength - entropy in bits (128 = 12 words, 256 = 24 words)
 */
export async function generateMnemonic(strength: number = 256): Promise<string> {
  return _gen(wordlist, strength);
}

export async function entropyToMnemonic(entropy: Uint8Array): Promise<string> {
  return _etm(entropy, wordlist);
}

export async function validateMnemonic(mnemonic: string): Promise<boolean> {
  return _validate(mnemonic, wordlist);
}

export async function mnemonicToSeed(mnemonic: string, passphrase: string = ''): Promise<Uint8Array> {
  return _seedSync(mnemonic, passphrase);
}
