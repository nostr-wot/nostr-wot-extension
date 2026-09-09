import type { LnurlPayParams } from './lnurl.ts';

/** Safe confirmation data returned by wallet_resolveLightningAddress. */
export interface ResolvedAddress extends Pick<LnurlPayParams,
  'address' | 'domain' | 'description' | 'commentAllowed' | 'allowsNostr'> {
  minSats: number;
  maxSats: number;
}
