/** Registered hardened coin types: https://github.com/satoshilabs/slips/blob/master/slip-0044.md */
export const KNOWN_BIP44_NETWORKS: Readonly<Record<number, string>> = {
  0: 'Bitcoin', 1: 'Testnet', 2: 'Litecoin', 3: 'Dogecoin', 5: 'Dash',
  60: 'Ethereum', 61: 'Ethereum Classic', 118: 'Cosmos', 144: 'XRP',
  145: 'Bitcoin Cash', 148: 'Stellar', 195: 'Tron', 501: 'Solana',
  1237: 'Nostr', 1815: 'Cardano',
};

/** Bitcoin purposes: BIP-49, BIP-84 and BIP-86. */
export const BITCOIN_PATH_PURPOSES: Readonly<Record<number, string>> = {
  49: 'BIP-49', 84: 'BIP-84', 86: 'BIP-86',
};
