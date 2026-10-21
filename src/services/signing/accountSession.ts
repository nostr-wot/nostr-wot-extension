import * as vault from '../vault/vault.ts';

/** A capability is bound to one vault session or one public-only phone connection. */
export interface AccountSession {
  accountId: string;
  revision: number;
  transportRevision: number;
  network?: true;
}

let networkSession: (AccountSession & { pubkey: string }) | undefined;
let networkRevision = 0;
let transportRevision = 0;
/** Retire signing capabilities without locking or mutating the vault. */
export function invalidateSigningTransport(): void { transportRevision++; }
/** A public-only capability; it cannot unlock or access the encrypted vault. */
export function beginNetworkSession(accountId: string, pubkey: string): AccountSession {
  networkSession = { accountId, pubkey, revision: ++networkRevision, transportRevision, network: true };
  return { accountId, revision: networkSession.revision, transportRevision, network: true };
}
export function endNetworkSession(): void { networkSession = undefined; }
export function networkSessionPubkey(session: AccountSession): string | undefined {
  if (!session.network) return undefined;
  assertAccountSession(session);
  return networkSession?.pubkey;
}

export function captureAccountSession(accountId = vault.getActiveAccountId(), revision = vault.getSessionRevision()): AccountSession {
  if (!accountId) throw new Error('No active account');
  if (networkSession?.accountId === accountId) return { accountId, revision: networkSession.revision, transportRevision: networkSession.transportRevision, network: true };
  return { accountId, revision, transportRevision };
}

/** Synchronous: callers dispatch immediately afterwards, without another await. */
export function assertAccountSession(session: AccountSession): void {
  if (session.network) {
    if (session.transportRevision !== transportRevision || !networkSession || networkSession.accountId !== session.accountId || networkSession.revision !== session.revision) throw new Error('Phone signer session changed');
    return;
  }
  if (vault.isLocked()) throw new Error('Vault is locked');
  if (session.transportRevision !== transportRevision) throw new Error('Signing transport session changed');
  if (vault.getSessionRevision() !== session.revision || vault.getActiveAccountId() !== session.accountId) {
    throw new Error('Account switched or vault session changed');
  }
}
