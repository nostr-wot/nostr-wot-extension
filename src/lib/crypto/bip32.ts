/**
 * BIP-32 — Hierarchical Deterministic Key Derivation — a thin adapter over
 * `@nostr-wot/accounts`.
 *
 * `derivePath` is the shared one; the async signature stays because every call site here
 * awaits it and nothing underneath was ever async.
 *
 * @see https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki — BIP-32
 * @see https://github.com/nostr-protocol/nips/blob/master/06.md — NIP-06
 *
 * @module lib/crypto/bip32
 */

import { HDKey } from '@scure/bip32';
import { derivePath as sharedDerivePath } from '@nostr-wot/accounts';

/** The private key at `path`. Live key material: the caller owns it and should zero it. */
export async function derivePath(seed: Uint8Array, path: string): Promise<Uint8Array> {
  return sharedDerivePath(seed, path);
}

/**
 * The master key and chain code.
 *
 * Not in the shared package: it hands out the chain code as well as the key, which is the
 * whole seed's authority rather than one identity's, and no shared consumer needs that.
 * This extension's post-quantum derivation does.
 */
export async function masterKeyFromSeed(seed: Uint8Array): Promise<{ privateKey: Uint8Array; chainCode: Uint8Array }> {
  const master = HDKey.fromMasterSeed(seed);
  try {
    return {
      privateKey: Uint8Array.from(master.privateKey!),
      chainCode: Uint8Array.from(master.chainCode!)
    };
  } finally {
    master.wipePrivateData();
  }
}
