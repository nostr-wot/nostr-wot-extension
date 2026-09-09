import type { SafeAccount } from './types.ts';

/** Minimal public account projection for UI surfaces; never includes secret fields. */
export type Account = Pick<SafeAccount, 'id' | 'pubkey'>
  & Partial<Pick<SafeAccount, 'name' | 'readOnly' | 'type'>>;
