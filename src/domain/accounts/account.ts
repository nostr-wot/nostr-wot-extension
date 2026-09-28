import { toSafeAccount } from '@nostr-wot/accounts';
import type { SafeAccount } from './types.ts';

/** Minimal public account projection for UI surfaces; never includes secret fields. */
export type Account = Pick<SafeAccount, 'id' | 'pubkey'>
  & Partial<Pick<SafeAccount, 'name' | 'readOnly' | 'type' | 'derivationPath' | 'derivationIndex'>>;

/**
 * Copy only the documented public fields; nested credentials and future fields stay private.
 *
 * The shared one. The type alone is a promise and this is the enforcement, so there must be
 * exactly one of it: a second copy is the one that forgets to drop a field the first one
 * learned to drop. `walletConfig`, which this extension adds to `Account` and the package
 * does not carry, is private by the same rule — it is not on the allowlist, so it is not
 * copied.
 */
export { toSafeAccount };
