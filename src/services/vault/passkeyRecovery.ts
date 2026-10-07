import { PASSKEY_RP_ID, PASSKEY_TIMEOUT_MS, PASSKEY_MAX_BLOB_BYTES } from '@constants/passkey.ts';
import { parsePasskeyBackup, type PasskeyProof } from '@domain/vault/passkey.ts';
import { arrayToBase64, base64ToArray } from '@lib/crypto/utils.ts';
import { authenticatePasskey, passkeysAvailable } from './passkeyClient.ts';

type BlobInput = AuthenticationExtensionsClientInputs & { largeBlob: { read: true } | { write: BufferSource } };
type BlobOutput = AuthenticationExtensionsClientOutputs & { largeBlob?: { written?: boolean; blob?: ArrayBuffer } };

/** The browser selects the provider; a write must target exactly one credential. */
async function requestBlob(largeBlob: BlobInput['largeBlob'], credentialId?: string, signal?: AbortSignal): Promise<PublicKeyCredential> {
  if (!passkeysAvailable()) throw new Error('Passkeys are unavailable in this browser.');
  const credential = await navigator.credentials.get({ signal, publicKey: {
    rpId: PASSKEY_RP_ID,
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    ...(credentialId ? { allowCredentials: [{ type: 'public-key' as const, id: base64ToArray(credentialId) as BufferSource }] } : {}),
    userVerification: 'required', timeout: PASSKEY_TIMEOUT_MS,
    extensions: { largeBlob } as BlobInput,
  } }) as PublicKeyCredential | null;
  if (!credential || (credentialId && arrayToBase64(new Uint8Array(credential.rawId)) !== credentialId)) throw new Error('Passkey request cancelled or credential did not match');
  return credential;
}

function readBlob(credential: PublicKeyCredential): Uint8Array {
  const blob = (credential.getClientExtensionResults() as BlobOutput).largeBlob?.blob;
  if (!blob || !blob.byteLength || blob.byteLength > PASSKEY_MAX_BLOB_BYTES) throw new Error('No usable recovery data on this passkey. Use your recovery file instead.');
  return new Uint8Array(blob);
}

/** Save the existing encrypted format, then verify a separate read before skipping file recovery. */
export async function savePasskeyRecovery(backup: string, credentialId: string, signal?: AbortSignal): Promise<void> {
  const record = parsePasskeyBackup(backup);
  if (!record.passkeys.some(key => key.credentialId === credentialId)) throw new Error('Passkey does not belong to this backup');
  const bytes = new TextEncoder().encode(backup);
  if (bytes.byteLength > PASSKEY_MAX_BLOB_BYTES) throw new Error('Recovery data exceeds the passkey storage limit. Download a recovery file instead.');
  const written = await requestBlob({ write: bytes }, credentialId, signal);
  if ((written.getClientExtensionResults() as BlobOutput).largeBlob?.written !== true) throw new Error('This provider could not save recovery data. Download a recovery file instead.');
  const actual = readBlob(await requestBlob({ read: true }, credentialId, signal));
  if (actual.length !== bytes.length || !actual.every((byte, i) => byte === bytes[i])) throw new Error('Recovery verification failed. Download a recovery file instead.');
}

/** Discover on a fresh install, bind the blob to its credential, then prove PRF access. */
export async function restorePasskeyRecovery(): Promise<{ backup: string; proof: PasskeyProof }> {
  const credential = await requestBlob({ read: true });
  const backup = new TextDecoder('utf-8', { fatal: true }).decode(readBlob(credential));
  const record = parsePasskeyBackup(backup);
  const credentialId = arrayToBase64(new Uint8Array(credential.rawId));
  const metadata = record.passkeys.find(key => key.credentialId === credentialId);
  if (!metadata) throw new Error('Recovery data does not belong to the selected passkey');
  return { backup, proof: await authenticatePasskey(metadata) };
}
