/**
 * BIP-39 — mnemonic generation and seed derivation — a thin adapter over
 * `@nostr-wot/accounts`.
 *
 * The wordlist, the strength default and the validation all live in the package now. The
 * async signatures stay because nothing underneath them ever was async and every call site
 * here already awaits: making them synchronous would be a wider change than the migration,
 * for no behaviour.
 *
 * @see https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki — BIP-39
 * @module lib/crypto/bip39
 */
import {
  GENERATED_MNEMONIC_STRENGTH_BITS,
  generateMnemonic as sharedGenerate,
  mnemonicToSeed as sharedMnemonicToSeed,
  validateMnemonic as sharedValidate,
} from '@nostr-wot/accounts';
import { entropyToMnemonic as _etm } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

/**
 * Generate a BIP-39 mnemonic.
 *
 * Defaults to 256 bits (24 words) rather than the BIP-39 minimum, because that is the
 * policy the rest of the extension enforces: `generateNewAccount()` mints 256-bit
 * identities, and the post-quantum handlers reject a 12-word seed as 'short-seed' since 128
 * bits would become the weakest link. The package carries the same default, for the same
 * reason; the constant is imported rather than restated so the two cannot drift.
 *
 * @param strength - entropy in bits (128 = 12 words, 256 = 24 words)
 */
export async function generateMnemonic(strength: number = GENERATED_MNEMONIC_STRENGTH_BITS): Promise<string> {
  return sharedGenerate(strength as 128 | 256);
}

/**
 * Entropy to mnemonic. Not in the shared package: nothing outside this extension's
 * post-quantum key-file import needs it, and it takes entropy the caller already holds
 * rather than drawing its own, which is a different contract from `generateMnemonic`.
 */
export async function entropyToMnemonic(entropy: Uint8Array): Promise<string> {
  return _etm(entropy, wordlist);
}

export async function validateMnemonic(mnemonic: string): Promise<boolean> {
  return sharedValidate(mnemonic);
}

export async function mnemonicToSeed(mnemonic: string, passphrase: string = ''): Promise<Uint8Array> {
  return sharedMnemonicToSeed(mnemonic, passphrase);
}
