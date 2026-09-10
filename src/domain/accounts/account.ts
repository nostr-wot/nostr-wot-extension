import type { SafeAccount } from './types.ts';

/** Minimal public account projection for UI surfaces; never includes secret fields. */
export type Account = Pick<SafeAccount, 'id' | 'pubkey'>
  & Partial<Pick<SafeAccount, 'name' | 'readOnly' | 'type' | 'derivationPath' | 'derivationIndex'>>;

/** Copy only documented public fields; nested credentials and future fields stay private. */
export function toSafeAccount(account: SafeAccount): SafeAccount {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    pubkey: account.pubkey,
    readOnly: account.readOnly,
    createdAt: account.createdAt,
    ...(account.derivationIndex !== undefined ? { derivationIndex: account.derivationIndex } : {}),
    ...(account.derivationPath !== undefined ? { derivationPath: account.derivationPath } : {}),
  };
}
