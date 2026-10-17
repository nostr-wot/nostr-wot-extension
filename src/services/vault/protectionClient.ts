import { rpc, rpcRead } from '@services/rpc';
import type { PasskeyMetadata } from '@domain/vault/passkey';
import { authenticatePasskey } from './passkeyClient';

/** Verify the current credential before replacing passkey protection, including None. */
export async function changePasskeyProtection(password: string, autoLockMs: number): Promise<void> {
  const metadata = await rpcRead<PasskeyMetadata>('vault_getPasskey');
  const proof = await authenticatePasskey(metadata);
  try { await rpc('vault_changeProtection', { currentPasskey: proof, usePasskey: false, password, autoLockMs }); }
  finally { proof.prf = ''; }
}
