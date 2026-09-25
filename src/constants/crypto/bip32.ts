import {
  NIP06_PATH as SHARED_NIP06_PATH,
  NIP06_ACCOUNT_PREFIX as SHARED_NIP06_ACCOUNT_PREFIX,
  MAX_BIP32_INDEX as SHARED_MAX_BIP32_INDEX,
  MAX_BIP32_DEPTH as SHARED_MAX_BIP32_DEPTH,
  MAX_BIP32_PATH_LENGTH as SHARED_MAX_BIP32_PATH_LENGTH,
} from '@nostr-wot/accounts';

/*
 * The NIP-06 path parameters, taken from `@nostr-wot/accounts`.
 *
 * These are values, not a re-export barrel: the package owns the numbers, this module only
 * keeps the `@constants/crypto/bip32.ts` import path alive for the files that already use
 * it. There is still exactly one definition, so the two cannot disagree — and they must not,
 * because these decide which identity a seed phrase restores. A local copy that drifted by
 * one would hand a user a different set of accounts with no error anywhere, which reads to
 * them as their accounts having been lost.
 *
 * New code should import from `@nostr-wot/accounts` directly. This file can go when the two
 * crypto test files that import it can be touched.
 */

export const NIP06_PATH: string = SHARED_NIP06_PATH;
export const NIP06_ACCOUNT_PREFIX: string = SHARED_NIP06_ACCOUNT_PREFIX;
export const MAX_BIP32_INDEX: number = SHARED_MAX_BIP32_INDEX;
export const MAX_BIP32_DEPTH: number = SHARED_MAX_BIP32_DEPTH;
export const MAX_BIP32_PATH_LENGTH: number = SHARED_MAX_BIP32_PATH_LENGTH;
