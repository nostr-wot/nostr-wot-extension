import { t } from '@services/i18n/i18n.ts';
import { PASSKEY_RP_ID, LEGACY_PASSKEY_RP_ID, PASSKEY_RECOVERY_PRF, PASSKEY_TIMEOUT_MS } from '@constants/passkey.ts';
import { arrayToBase64, base64ToArray } from '@lib/crypto/utils.ts';
import { parsePasskeyBackup, validRpId, validPasskeyName, defaultPasskeyName, type PasskeyInput, type RecoveryScope, type PasskeyMetadata, type PasskeyProof } from '@domain/vault/passkey.ts';

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
  if (!metadata || !validRpId(metadata.rpId ?? LEGACY_PASSKEY_RP_ID)) throw new Error('Invalid passkey domain');
  const credential = await requestPasskey(() => navigator.credentials.get({ publicKey: {
    rpId: metadata.rpId ?? LEGACY_PASSKEY_RP_ID,
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials: [{ type: 'public-key', id: base64ToArray(metadata.credentialId) as BufferSource }],
    userVerification: 'required', timeout: PASSKEY_TIMEOUT_MS,
    extensions: { prf: { eval: { first: base64ToArray(metadata.prfSalt) as BufferSource } } } as PrfExtensions,
  } })) as PublicKeyCredential | null;
  if (!credential || arrayToBase64(new Uint8Array(credential.rawId)) !== metadata.credentialId) throw new Error('Passkey request cancelled or credential did not match');
  return readPasskeyProof(credential, metadata.credentialId);
}

/** Consume transient PRF output only for the selected credential. */
export function readPasskeyProof(credential: PublicKeyCredential, credentialId: string): PasskeyProof {
  if (arrayToBase64(new Uint8Array(credential.rawId)) !== credentialId) throw new Error('Recovery credential mismatch');
  return { credentialId, prf: encodePrf((credential.getClientExtensionResults() as PrfResult).prf?.results?.first) };
}
export function clearPasskeyPrf(credential: PublicKeyCredential): void {
  const output = (credential.getClientExtensionResults() as PrfResult).prf?.results?.first;
  if (output) new Uint8Array(output).fill(0);
}

/** The one message for a provider that returns no usable PRF output, whatever the flow. */
export const PRF_UNAVAILABLE_MESSAGE = 'This passkey provider cannot encrypt a vault (PRF is unavailable). Retry and choose another provider in the browser, or use seed phrase setup.';

function encodePrf(output: ArrayBuffer | undefined): string {
  if (!output || output.byteLength !== 32) throw new Error(PRF_UNAVAILABLE_MESSAGE);
  const bytes = new Uint8Array(output);
  try { return arrayToBase64(bytes); }
  finally { bytes.fill(0); }
}

export async function createPasskey(name: string, options: { rpId?: string; pubkey?: string; scope?: RecoveryScope; excludeCredentials?: readonly PasskeyMetadata[] } = {}): Promise<PasskeyInput> {
  requireSupport();
  const rpId = options.rpId ?? PASSKEY_RP_ID;
  if (!validRpId(rpId) || (options.pubkey !== undefined && !/^[0-9a-f]{64}$/.test(options.pubkey))) throw new Error('Invalid passkey domain or account');
  const label = name.trim() || defaultPasskeyName(options.excludeCredentials?.length ?? 0);
  if (!validPasskeyName(label)) throw new Error('Invalid passkey name');
  const salt = options.pubkey ? base64ToArray(PASSKEY_RECOVERY_PRF) : crypto.getRandomValues(new Uint8Array(32));
  const credential = await requestPasskey(() => navigator.credentials.create({ publicKey: {
    rp: { id: rpId, name: 'Nostr WoT Vault' },
    user: { id: options.pubkey ? Uint8Array.from(options.pubkey.match(/../g)!, byte => parseInt(byte, 16)) : crypto.getRandomValues(new Uint8Array(32)), name: label, displayName: label },
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    excludeCredentials: options.excludeCredentials?.filter(item => (item.rpId ?? LEGACY_PASSKEY_RP_ID) === rpId).map(item => ({ type: 'public-key' as const, id: base64ToArray(item.credentialId) as BufferSource })),
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    // Leave attachment and provider hints unset: the browser owns provider selection.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    attestation: 'none', timeout: PASSKEY_TIMEOUT_MS,
    extensions: { largeBlob: { support: 'preferred' }, prf: { eval: { first: salt as BufferSource } } } as PrfExtensions,
  } })) as PublicKeyCredential | null;
  if (!credential) throw new Error('Passkey creation cancelled');
  const initial = (credential.getClientExtensionResults() as PrfResult).prf;
  const metadata = { name: label, rpId, ...(options.pubkey ? { recoveryPubkey: options.pubkey, recoveryScope: options.scope ?? 'vault' } : {}), credentialId: arrayToBase64(new Uint8Array(credential.rawId)), prfSalt: arrayToBase64(salt) };
  // Registration already requires user verification; reuse its PRF when supplied.
  const proof = initial?.results?.first ? { credentialId: metadata.credentialId, prf: encodePrf(initial.results.first) } : await authenticatePasskey(metadata);
  return { ...metadata, ...proof, largeBlobSupported: (credential.getClientExtensionResults() as PrfResult).largeBlob?.supported === true };
}

export function parsePasskeyBackupMetadata(text: string): PasskeyMetadata {
  const record = parsePasskeyBackup(text);
  const { iv: _iv, ciphertext: _ciphertext, ...metadata } = record.passkeys[0];
  return { ...metadata, rpId: metadata.rpId ?? record.rpId };
}

/** Browsers deliberately use NotAllowedError for both cancellation and timeout. */
export async function requestPasskey<T>(request: () => Promise<T>): Promise<T> {
  try { return await request(); }
  catch (error) {
    if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError')) throw new Error(t('passkey.cancelled'));
    throw error;
  }
}

/** Request only the selected HTTPS RP origin, from an explicit user gesture. */
export async function authorizePasskeyDomain(rpId: string): Promise<void> {
  if (!validRpId(rpId)) throw new Error('Enter a domain without a scheme or path');
  if (rpId === PASSKEY_RP_ID || rpId === LEGACY_PASSKEY_RP_ID) return;
  const { default: browser } = await import('@lib/browser.ts');
  if (!browser.permissions || !await browser.permissions.request({ origins: [`https://${rpId}/*`] })) throw new Error('Access to this passkey domain was not granted');
}

/** A verified assertion's public handle and a private copy of its PRF output. */
export interface PrfAssertion { credentialId: Uint8Array; userHandle: Uint8Array | null; prf: Uint8Array | null; }

/**
 * Assert a passkey under another site's RP ID with one PRF input. Discoverable when no
 * credential ID is given; otherwise targeted at that credential. The browser's own PRF
 * buffer is zeroed before returning; the caller zeroes `prf` once it is done with it.
 * A missing or malformed PRF result is reported as `prf: null`, never as an error, so the
 * caller can classify the handle first.
 */
export async function assertPasskeyPrf(rpId: string, prfInput: Uint8Array, credentialId?: Uint8Array): Promise<PrfAssertion> {
  requireSupport();
  if (!validRpId(rpId) || prfInput.length !== 32) throw new Error('Invalid passkey domain');
  const credential = await requestPasskey(() => navigator.credentials.get({ publicKey: {
    rpId,
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    ...(credentialId ? { allowCredentials: [{ type: 'public-key' as const, id: credentialId as BufferSource }] } : {}),
    userVerification: 'required', timeout: PASSKEY_TIMEOUT_MS,
    extensions: { prf: { eval: { first: prfInput as BufferSource } } } as PrfExtensions,
  } })) as PublicKeyCredential | null;
  if (!credential) throw new Error(t('passkey.cancelled'));
  const output = (credential.getClientExtensionResults?.() as PrfResult | undefined)?.prf?.results?.first;
  let prf: Uint8Array | null = null;
  if (output) {
    const view = new Uint8Array(output);
    if (view.length === 32) prf = view.slice();
    view.fill(0);
  }
  const handle = (credential.response as AuthenticatorAssertionResponse | undefined)?.userHandle;
  return { credentialId: new Uint8Array(credential.rawId).slice(), userHandle: handle && handle.byteLength ? new Uint8Array(handle).slice() : null, prf };
}
