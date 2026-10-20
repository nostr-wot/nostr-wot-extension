import { recoveryContextFromEvent } from './recoveryCodec.ts';
import { rpc } from '@services/rpc.ts';
import type { SignedEvent } from '@domain/nostr/types.ts';
import { PASSKEY_RP_ID, PASSKEY_TIMEOUT_MS, PASSKEY_MAX_BLOB_BYTES, PASSKEY_RECOVERY_PRF } from '@constants/passkey.ts';
import { parsePasskeyBackup, validRpId, type RecoveryScope, type PasskeyProof } from '@domain/vault/passkey.ts';
import { arrayToBase64, base64ToArray, bytesToHex } from '@lib/crypto/utils.ts';
import { authenticatePasskey, passkeysAvailable, requestPasskey, readPasskeyProof, clearPasskeyPrf } from './passkeyClient.ts';

export class RecoveryFileRequiredError extends Error {}

type BlobInput = AuthenticationExtensionsClientInputs & { largeBlob: { read: true } | { write: BufferSource } };
type BlobOutput = AuthenticationExtensionsClientOutputs & { largeBlob?: { written?: boolean; blob?: ArrayBuffer } };

/** The browser selects the provider; a write must target exactly one credential. */
async function requestBlob(largeBlob: BlobInput['largeBlob'], credentialId?: string, signal?: AbortSignal, rpId = PASSKEY_RP_ID, includePrf = false): Promise<PublicKeyCredential> {
  if (!validRpId(rpId)) throw new Error('Invalid passkey domain');
  if (!passkeysAvailable()) throw new Error('Passkeys are unavailable in this browser.');
  const credential = await requestPasskey(() => navigator.credentials.get({ signal, publicKey: {
    rpId,
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    ...(credentialId ? { allowCredentials: [{ type: 'public-key' as const, id: base64ToArray(credentialId) as BufferSource }] } : {}),
    userVerification: 'required', timeout: PASSKEY_TIMEOUT_MS,
    extensions: { largeBlob, ...(includePrf ? { prf: { eval: { first: base64ToArray(PASSKEY_RECOVERY_PRF) as BufferSource } } } : {}) } as BlobInput,
  } })) as PublicKeyCredential | null;
  if (!credential || (credentialId && arrayToBase64(new Uint8Array(credential.rawId)) !== credentialId)) throw new Error('Passkey request cancelled or credential did not match');
  return credential;
}

function readBlob(credential: PublicKeyCredential): Uint8Array {
  const blob = (credential.getClientExtensionResults() as BlobOutput).largeBlob?.blob;
  if (!blob || !blob.byteLength || blob.byteLength > PASSKEY_MAX_BLOB_BYTES) throw new Error('No usable recovery data on this passkey. Use your recovery file instead.');
  return new Uint8Array(blob);
}

/** Save the encrypted format; WebAuthn written=true confirms storage without a second prompt. */
export async function savePasskeyRecovery(backup: string, credentialId: string, signal?: AbortSignal): Promise<void> {
  const record = parsePasskeyBackup(backup);
  if (!record.passkeys.some(key => key.credentialId === credentialId)) throw new Error('Passkey does not belong to this backup');
  const bytes = new TextEncoder().encode(backup);
  if (bytes.byteLength > PASSKEY_MAX_BLOB_BYTES) throw new Error('Recovery data exceeds the passkey storage limit. Download a recovery file instead.');
  const written = await requestBlob({ write: bytes }, credentialId, signal, record.passkeys.find(p => p.credentialId === credentialId)?.rpId ?? record.rpId);
  if ((written.getClientExtensionResults() as BlobOutput).largeBlob?.written !== true) {
    await rpc('vault_recordBlobUnavailable', { credentialId });
    throw new Error('This provider could not save recovery data. Download a recovery file instead.');
  }
  await rpc('vault_recordBlobSaved', { credentialId });

}

/** Select a credential without importing or decrypting any recovery material. */
export async function discoverPasskeyRecovery(rpId = PASSKEY_RP_ID): Promise<PublicKeyCredential> {
  return requestBlob({ read: true }, undefined, undefined, rpId, true);
}

/** Discover on a fresh install, bind the blob to its credential, then prove PRF access. */
export async function restorePasskeyRecovery(rpId = PASSKEY_RP_ID, scope?: RecoveryScope, discovered?: PublicKeyCredential): Promise<{ backup: string; proof: PasskeyProof } | { event: SignedEvent; proof: PasskeyProof; context: import('./recoveryCodec.ts').RecoveryContext }> {
  const credential = discovered ?? await discoverPasskeyRecovery(rpId);
  try {
  const combinedPrf = (credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & { prf?: { results?: { first?: ArrayBuffer } } }).prf?.results?.first;
  const blob = (credential.getClientExtensionResults() as BlobOutput).largeBlob?.blob;
  if (!blob || !blob.byteLength) {
    const userHandle = (credential.response as AuthenticatorAssertionResponse).userHandle;
    if (!userHandle || userHandle.byteLength !== 32) throw new RecoveryFileRequiredError('No recovery data was found for this passkey. Import your recovery file to continue.');
    const discovery = { credentialId: arrayToBase64(new Uint8Array(credential.rawId)), rpId, pubkey: bytesToHex(new Uint8Array(userHandle)) };
    let event: SignedEvent;
    try { event = await rpc<SignedEvent>('vault_fetchRelayRecovery', { ...discovery, scope }); }
    catch { throw new RecoveryFileRequiredError('Recovery data could not be retrieved from relays. Import your recovery file to continue.'); }
    const context = recoveryContextFromEvent(event, discovery);
    const proof = combinedPrf ? readPasskeyProof(credential, context.credentialId) : await authenticatePasskey({ credentialId: context.credentialId, rpId, prfSalt: PASSKEY_RECOVERY_PRF });
    return { event, proof, context };
  }
  const backup = new TextDecoder('utf-8', { fatal: true }).decode(readBlob(credential));
  const record = parsePasskeyBackup(backup);
  const credentialId = arrayToBase64(new Uint8Array(credential.rawId));
  const metadata = record.passkeys.find(key => key.credentialId === credentialId);
  if (!metadata || (metadata.rpId ?? record.rpId) !== rpId) throw new Error('Recovery data does not belong to the selected passkey domain');
  return { backup, proof: combinedPrf && metadata.prfSalt === PASSKEY_RECOVERY_PRF ? readPasskeyProof(credential, credentialId) : await authenticatePasskey({ ...metadata, rpId: metadata.rpId ?? record.rpId }) };
  } finally { clearPasskeyPrf(credential); }
}
