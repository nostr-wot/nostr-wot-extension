import { t } from '@services/i18n/i18n.ts';
import { PASSKEY_RP_ID, PASSKEY_TIMEOUT_MS } from '@constants/passkey.ts';
import { arrayToBase64, base64ToArray } from '@lib/crypto/utils.ts';
import { parsePasskeyBackup, type PasskeyInput, type PasskeyMetadata, type PasskeyProof } from '@domain/vault/passkey.ts';

type PrfExtensions = AuthenticationExtensionsClientInputs & { largeBlob?: { support: 'preferred' }; prf: { eval: { first: BufferSource } } };
type PrfResult = AuthenticationExtensionsClientOutputs & { largeBlob?: { supported?: boolean }; prf?: { enabled?: boolean; results?: { first: ArrayBuffer } } };

export function passkeysAvailable(): boolean {
  return typeof PublicKeyCredential !== 'undefined' && typeof navigator.credentials?.create === 'function' && typeof navigator.credentials?.get === 'function';
}

function requireSupport(): void {
  if (!passkeysAvailable()) throw new Error('Passkeys are unavailable in this browser. Use seed phrase setup instead.');
}

/** No network service or website script participates in vault unlocking. */
export async function authenticatePasskey(metadata: PasskeyMetadata): Promise<PasskeyProof> {
  requireSupport();
  const credential = await requestPasskey(() => navigator.credentials.get({ publicKey: {
    rpId: PASSKEY_RP_ID,
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials: [{ type: 'public-key', id: base64ToArray(metadata.credentialId) as BufferSource }],
    userVerification: 'required', timeout: PASSKEY_TIMEOUT_MS,
    extensions: { prf: { eval: { first: base64ToArray(metadata.prfSalt) as BufferSource } } } as PrfExtensions,
  } })) as PublicKeyCredential | null;
  if (!credential || arrayToBase64(new Uint8Array(credential.rawId)) !== metadata.credentialId) throw new Error('Passkey request cancelled or credential did not match');
  const output = (credential.getClientExtensionResults() as PrfResult).prf?.results?.first;
  return { credentialId: metadata.credentialId, prf: encodePrf(output) };
}

function encodePrf(output: ArrayBuffer | undefined): string {
  if (!output || output.byteLength !== 32) throw new Error('This passkey provider cannot encrypt a vault (PRF is unavailable). Retry and choose another provider in the browser, or use seed phrase setup.');
  const bytes = new Uint8Array(output);
  try { return arrayToBase64(bytes); }
  finally { bytes.fill(0); }
}

export async function createPasskey(name: string): Promise<PasskeyInput> {
  requireSupport();
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const credential = await requestPasskey(() => navigator.credentials.create({ publicKey: {
    rp: { id: PASSKEY_RP_ID, name: 'Nostr WoT Vault' },
    user: { id: crypto.getRandomValues(new Uint8Array(32)), name: name.trim() || 'Nostr WoT', displayName: name.trim() || 'Nostr WoT' },
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    // Leave attachment and provider hints unset: the browser owns provider selection.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    attestation: 'none', timeout: PASSKEY_TIMEOUT_MS,
    extensions: { largeBlob: { support: 'preferred' }, prf: { eval: { first: salt } } } as PrfExtensions,
  } })) as PublicKeyCredential | null;
  if (!credential) throw new Error('Passkey creation cancelled');
  const initial = (credential.getClientExtensionResults() as PrfResult).prf;
  const metadata = { credentialId: arrayToBase64(new Uint8Array(credential.rawId)), prfSalt: arrayToBase64(salt) };
  // Registration already requires user verification; reuse its PRF when supplied.
  const proof = initial?.results?.first ? { credentialId: metadata.credentialId, prf: encodePrf(initial.results.first) } : await authenticatePasskey(metadata);
  return { ...metadata, ...proof, largeBlobSupported: (credential.getClientExtensionResults() as PrfResult).largeBlob?.supported === true };
}

export function parsePasskeyBackupMetadata(text: string): PasskeyMetadata {
  const record = parsePasskeyBackup(text);
  const { credentialId, prfSalt } = record.passkeys[0];
  return { credentialId, prfSalt };
}

/** Browsers deliberately use NotAllowedError for both cancellation and timeout. */
export async function requestPasskey<T>(request: () => Promise<T>): Promise<T> {
  try { return await request(); }
  catch (error) {
    if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError')) throw new Error(t('passkey.cancelled'));
    throw error;
  }
}
