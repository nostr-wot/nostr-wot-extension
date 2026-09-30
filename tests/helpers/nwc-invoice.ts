import { bech32 } from '@scure/base';
import { createHash } from 'node:crypto';

/** Synthetic decoder fixture with a real preimage/hash relationship; no Lightning payment. */
export function makeNwcInvoice(preimage = 'ab'.repeat(32)): string {
  const hash = bech32.toWords(createHash('sha256').update(Buffer.from(preimage, 'hex')).digest());
  return bech32.encode('lnbc2500u', [...Array(7).fill(0), 1, 1, 20, ...hash, ...Array(104).fill(0)], 2000);
}
