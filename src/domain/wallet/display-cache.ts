import type { Transaction } from './types.ts';
import { WALLET_DISPLAY_CACHE_PREFIX } from '@constants/wallet.ts';
/** Display data only. Credentials, invoices and preimages never enter this cache; financial fields are encrypted at rest. */
export interface WalletDisplayCache {
  providerType: string | false;
  balance?: number;
  transactions?: Transaction[];
  updatedAt?: number;
}
export const walletDisplayKey = (accountId: string) => `${WALLET_DISPLAY_CACHE_PREFIX}${accountId}`;
