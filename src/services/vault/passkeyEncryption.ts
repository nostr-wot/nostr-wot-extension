import { PASSKEY_KDF_CONTEXT, PASSKEY_RP_ID } from '@constants/passkey.ts';
import { base64ToArray, arrayToBase64 } from '@lib/crypto/utils.ts';
import { validatePasskeyInput, type PasskeyInput, type PasskeyProof, type PasskeyWrapper } from '@domain/vault/passkey.ts';

async function wrappingKey(input: PasskeyInput): Promise<CryptoKey> {
  validatePasskeyInput(input);
  const bytes = base64ToArray(input.prf);
  try {
    const material = await crypto.subtle.importKey('raw', bytes as BufferSource, 'HKDF', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: base64ToArray(input.prfSalt) as BufferSource, info: new TextEncoder().encode(PASSKEY_KDF_CONTEXT) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { bytes.fill(0); }
}

function binding(wrapper: { credentialId: string; prfSalt: string }): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify([PASSKEY_KDF_CONTEXT, PASSKEY_RP_ID, wrapper.credentialId, wrapper.prfSalt]));
}

export async function wrapVaultKey(bytes: Uint8Array, input: PasskeyInput): Promise<PasskeyWrapper> {
  if (bytes.length !== 32) throw new Error('Invalid vault key');
  const key = await wrappingKey(input);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: binding(input) }, key, bytes as BufferSource);
  return { credentialId: input.credentialId, prfSalt: input.prfSalt, iv: arrayToBase64(iv), ciphertext: arrayToBase64(new Uint8Array(ciphertext)) };
}

export async function unwrapVaultKey(wrapper: PasskeyWrapper, proof: PasskeyProof): Promise<Uint8Array> {
  if (proof.credentialId !== wrapper.credentialId) throw new Error('Passkey does not belong to this vault');
  const key = await wrappingKey({ ...wrapper, prf: proof.prf });
  const bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToArray(wrapper.iv) as BufferSource, additionalData: binding(wrapper) }, key, base64ToArray(wrapper.ciphertext) as BufferSource));
  if (bytes.length !== 32) { bytes.fill(0); throw new Error('Invalid vault key'); }
  return bytes;
}

export async function importVaultKey(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', bytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
