import { KNOWN_BIP44_NETWORKS, BITCOIN_PATH_PURPOSES } from '@constants/derivation.ts';
import { normalizeDerivationPath, standardDerivationIndex } from '@nostr-wot/accounts';

/*
 * Path canonicalisation and the NIP-06 account index come from `@nostr-wot/accounts`. They
 * decide which key a stored path restores, so they belong with the derivation that uses
 * them; re-exported here so this module's existing importers do not all have to move.
 *
 * `identifyDerivationPath` stays: it is a label for a settings screen, it knows about
 * Bitcoin path conventions that have nothing to do with a Nostr signer, and no shared
 * consumer has asked for it.
 */
export { normalizeDerivationPath, standardDerivationIndex };

/** Identifies a registered prefix, not wallet compatibility or a complete wallet layout. */
export function identifyDerivationPath(value: string): { network: string; convention: string } | null {
  const path = normalizeDerivationPath(value);
  const match = path && /^m\/(\d+)'\/(\d+)'(?:\/|$)/.exec(path);
  if (!match) return null;
  const purpose = Number(match[1]), coin = Number(match[2]);
  if (purpose === 44 && KNOWN_BIP44_NETWORKS[coin]) {
    return { network: KNOWN_BIP44_NETWORKS[coin], convention: coin === 1237 ? 'NIP-06' : 'BIP-44' };
  }
  if (BITCOIN_PATH_PURPOSES[purpose] && (coin === 0 || coin === 1)) {
    return { network: coin === 0 ? 'Bitcoin' : 'Bitcoin testnet', convention: BITCOIN_PATH_PURPOSES[purpose] };
  }
  return null;
}
