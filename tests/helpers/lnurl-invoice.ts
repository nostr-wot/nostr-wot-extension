import { bech32 } from '@scure/base';
import { createHash } from 'node:crypto';

/** Decoder fixture only; signing/payment correctness is tested by providers. */
export function makeLnurlInvoice(metadata: string, hrp = 'lnbc2500u'): string {
  const hash = bech32.toWords(createHash('sha256').update(metadata).digest());
  return bech32.encode(hrp, [...Array(7).fill(0), 23, 1, 20, ...hash, ...Array(104).fill(0)], 2000);
}
