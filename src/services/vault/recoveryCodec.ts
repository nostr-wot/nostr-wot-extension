import { PASSKEY_RECOVERY_MAX_BYTES, PASSKEY_RECOVERY_SCHEMAS, PASSKEY_RECOVERY_KIND, PASSKEY_RECOVERY_VERSION } from '@constants/passkey.ts';
import { validRpId, type RecoveryScope } from '@domain/vault/passkey.ts';
import { arrayToBase64, base64ToArray } from '@lib/crypto/utils.ts';
import { verifyEvent } from '@lib/crypto/nip01.ts';
import type { SignedEvent } from '@domain/nostr/types.ts';

export interface RecoveryContext { credentialId: string; rpId: string; pubkey: string; scope: RecoveryScope; }
export const recoveryCredentialId = (value: string) => value.replace(/\+/g, '-').replace(/\//g, '_');
export function recoveryCoordinate(ctx: RecoveryContext): string {
  validate(ctx);
  const id = recoveryCredentialId(ctx.credentialId);
  return ctx.scope === 'private-key' ? id : `${id}:${ctx.scope}:${PASSKEY_RECOVERY_SCHEMAS[ctx.scope]}`;
}
function validate(ctx: RecoveryContext) {
  if (!validRpId(ctx.rpId) || !/^[a-f0-9]{64}$/.test(ctx.pubkey) || !['private-key', 'seed', 'vault'].includes(ctx.scope)) throw new Error('Invalid recovery context');
  const id = base64ToArray(ctx.credentialId);
  if (!id.length || id.length > 1024 || arrayToBase64(id) !== ctx.credentialId) throw new Error('Invalid recovery credential');
}
function aad(ctx: RecoveryContext): Uint8Array {
  validate(ctx);
  if (ctx.scope === 'private-key') {
    const prefix = new TextEncoder().encode('keytr');
    const id = base64ToArray(ctx.credentialId);
    const out = new Uint8Array(prefix.length + 1 + id.length);
    out.set(prefix); out[prefix.length] = 1; out.set(id, prefix.length + 1); return out;
  }
  return new TextEncoder().encode(JSON.stringify(['keytr', PASSKEY_RECOVERY_VERSION, ctx.scope, PASSKEY_RECOVERY_SCHEMAS[ctx.scope], ctx.rpId, ctx.pubkey, recoveryCredentialId(ctx.credentialId)]));
}
async function key(prf: string, salt: Uint8Array, ctx: RecoveryContext): Promise<CryptoKey> {
  const bytes = base64ToArray(prf);
  try {
    if (bytes.length !== 32) throw new Error('Invalid PRF output');
    const material = await crypto.subtle.importKey('raw', bytes as BufferSource, 'HKDF', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: new TextEncoder().encode(ctx.scope === 'private-key' ? 'keytr nsec encryption v1' : 'keytr payload encryption v4') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { bytes.fill(0); }
}
export async function encryptRecovery(payload: Uint8Array, prf: string, ctx: RecoveryContext): Promise<string> {
  const additionalData = aad(ctx);
  if (!payload.length || payload.length > PASSKEY_RECOVERY_MAX_BYTES || (ctx.scope === 'private-key' && payload.length !== 32)) throw new Error('Recovery payload exceeds the supported size');
  const iv = crypto.getRandomValues(new Uint8Array(12)); const salt = crypto.getRandomValues(new Uint8Array(32));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additionalData as BufferSource }, await key(prf, salt, ctx), payload as BufferSource);
  const blob = new Uint8Array(45 + encrypted.byteLength); blob[0] = ctx.scope === 'private-key' ? 1 : PASSKEY_RECOVERY_VERSION;
  blob.set(iv, 1); blob.set(salt, 13); blob.set(new Uint8Array(encrypted), 45); return arrayToBase64(blob);
}
export async function decryptRecovery(content: string, prf: string, ctx: RecoveryContext): Promise<Uint8Array> {
  const additionalData = aad(ctx);
  if (typeof content !== 'string' || content.length > Math.ceil((PASSKEY_RECOVERY_MAX_BYTES + 61) / 3) * 4) throw new Error('Recovery payload exceeds the supported size');
  const blob = base64ToArray(content);
  if (arrayToBase64(blob) !== content || blob.length <= 61 || blob.length > PASSKEY_RECOVERY_MAX_BYTES + 61 || blob[0] !== (ctx.scope === 'private-key' ? 1 : PASSKEY_RECOVERY_VERSION) || (ctx.scope === 'private-key' && blob.length !== 93)) throw new Error('Invalid recovery payload');
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(1, 13), additionalData: additionalData as BufferSource }, await key(prf, blob.slice(13, 45), ctx), blob.slice(45)));
}
export function recoveryTags(ctx: RecoveryContext): string[][] {
  validate(ctx);
  return [['d', recoveryCoordinate(ctx)], ['rp', ctx.rpId], ['algo', 'aes-256-gcm'], ['kdf', 'hkdf-sha256'], ['v', ctx.scope === 'private-key' ? '1' : String(PASSKEY_RECOVERY_VERSION)], ...(ctx.scope === 'private-key' ? [] : [['credential', recoveryCredentialId(ctx.credentialId)], ['type', ctx.scope], ['schema', PASSKEY_RECOVERY_SCHEMAS[ctx.scope]]]), ['client', 'Nostr WoT']];
}
export async function validateRecoveryEvent(event: SignedEvent, ctx: RecoveryContext): Promise<void> {
  validate(ctx);
  if (!event || event.kind !== PASSKEY_RECOVERY_KIND || event.pubkey !== ctx.pubkey || typeof event.content !== 'string' || event.content.length > Math.ceil((PASSKEY_RECOVERY_MAX_BYTES + 61) / 3) * 4 || !Array.isArray(event.tags) || event.tags.length > 32 || event.tags.some(tag => !Array.isArray(tag) || tag.length > 8 || tag.some(value => typeof value !== 'string' || value.length > 2048))) throw new Error('Invalid recovery event');
  for (const expected of recoveryTags(ctx).filter(t => t[0] !== 'client')) {
    const found = event.tags.filter(t => Array.isArray(t) && t[0] === expected[0]);
    if (found.length !== 1 || JSON.stringify(found[0]) !== JSON.stringify(expected)) throw new Error(`Invalid recovery ${expected[0]}`);
  }
  if (!await verifyEvent(event)) throw new Error('Invalid recovery event signature');
}

/** Type is explicit public metadata; validateRecoveryEvent authenticates it before decryption. */
export function recoveryContextFromEvent(event: SignedEvent, discovery: Omit<RecoveryContext, 'scope'>): RecoveryContext {
  if (!event || !Array.isArray(event.tags)) throw new Error('Invalid recovery event');
  const versions = event.tags.filter(tag => Array.isArray(tag) && tag[0] === 'v');
  if (versions.length !== 1) throw new Error('Invalid recovery version');
  if (versions[0][1] === '1') return { ...discovery, scope: 'private-key' };
  const types = event.tags.filter(tag => Array.isArray(tag) && tag[0] === 'type');
  if (versions[0][1] !== String(PASSKEY_RECOVERY_VERSION) || types.length !== 1 || !['seed', 'vault'].includes(types[0][1])) throw new Error('Unsupported recovery type');
  return { ...discovery, scope: types[0][1] as RecoveryScope };
}
