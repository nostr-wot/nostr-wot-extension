import { npubEncode } from '@lib/crypto/bech32.ts';


export function truncateNpub(pubkey: string): string {
  try {
    const npub = npubEncode(pubkey);
    return npub.slice(0, 12) + '...' + npub.slice(-4);
  } catch {
    return pubkey.slice(0, 8) + '...' + pubkey.slice(-4);
  }
}
