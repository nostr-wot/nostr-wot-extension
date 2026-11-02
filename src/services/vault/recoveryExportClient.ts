import { rpc, rpcRead } from '@services/rpc';
import type { PasskeyMetadata } from '@domain/vault/passkey';
import { authenticatePasskey } from './passkeyClient';

/** Password-protected vaults must prove access to the separate recovery wrapping key. */
export async function exportPasskeyRecovery(method: 'vault_exportPasskeyBackup' | 'vault_exportPasskeyBlob', credentialId?: string): Promise<string> {
  const active = await rpcRead<PasskeyMetadata | null>('vault_getPasskey');
  if (active) return rpc<string>(method, { credentialId });
  const credentials = await rpcRead<PasskeyMetadata[]>('vault_listPasskeys');
  const metadata = credentialId ? credentials.find(c => c.credentialId === credentialId) : credentials[0];
  if (!metadata) throw new Error('No registered passkey');
  const proof = await authenticatePasskey(metadata);
  try { return await rpc<string>(method, { credentialId: metadata.credentialId, proof }); }
  finally { proof.prf = ''; }
}
