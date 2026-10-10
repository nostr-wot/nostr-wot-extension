import { WALLET_MAX_FEE_PERCENT, WALLET_MAX_FEE_FLOOR_MSATS } from '@constants/wallet.ts';

/**
 * The most a routing fee may cost on an unattended payment of this size, in msat.
 *
 * A share of the amount, floored, because a percentage of a small invoice is below any
 * real routing fee and a bare percentage would refuse ordinary payments. This bounds
 * fees that are absurd relative to what is being sent; the rolling allowance is the
 * separate limit on how much may be spent silently in total.
 */
export function maxFeeMsatFor(amountMsats: number): number {
  if (!Number.isSafeInteger(amountMsats) || amountMsats <= 0) return WALLET_MAX_FEE_FLOOR_MSATS;
  return Math.max(WALLET_MAX_FEE_FLOOR_MSATS, Math.floor((amountMsats * WALLET_MAX_FEE_PERCENT) / 100));
}
