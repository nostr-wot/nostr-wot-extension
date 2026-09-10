import * as vault from '../vault/vault.ts';

/** A capability is valid only for the account and vault session that issued it. */
export interface AccountSession {
  accountId: string;
  revision: number;
}

export function captureAccountSession(accountId = vault.getActiveAccountId(), revision = vault.getSessionRevision()): AccountSession {
  if (!accountId) throw new Error('No active account');
  return { accountId, revision };
}

/** Synchronous: callers dispatch immediately afterwards, without another await. */
export function assertAccountSession(session: AccountSession): void {
  if (vault.isLocked()) throw new Error('Vault is locked');
  if (vault.getSessionRevision() !== session.revision || vault.getActiveAccountId() !== session.accountId) {
    throw new Error('Account switched or vault session changed');
  }
}
