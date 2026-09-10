import { WALLET_DISPLAY_CACHE_PREFIX, PAYMENT_INTENTS_STORAGE_KEY, WALLET_AUTO_BUDGET_PREFIX } from '@constants/wallet.ts';
import browser from '@lib/browser.ts';
import * as vault from '../vault/vault.ts';
import { arrayToBase64, base64ToArray } from '@lib/crypto/utils.ts';
import { AsyncLock } from '@utils/asyncLock.ts';

interface PrivateEnvelope { privateCache: 1; iv: string; ciphertext: string; }
const writes = new AsyncLock();
const aad = (key: string) => new TextEncoder().encode(`nostr-wot/private-cache/v1/${key}`);

export function isPrivateEnvelope(value: unknown): value is PrivateEnvelope {
  return !!value && typeof value === 'object' && (value as PrivateEnvelope).privateCache === 1;
}

/** Storage names are authenticated so encrypted records cannot be swapped between accounts. */
export async function sealPrivateValue(key: string, value: unknown): Promise<PrivateEnvelope> {
  return vault.withCacheKey(async cryptoKey => {
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(key) }, cryptoKey, plaintext);
      return { privateCache: 1, iv: arrayToBase64(iv), ciphertext: arrayToBase64(new Uint8Array(encrypted)) };
    } finally { plaintext.fill(0); }
  });
}

export async function writePrivateCache(key: string, value: unknown): Promise<void> {
  const revision = vault.getSessionRevision();
  await writes.run(async () => {
    if (revision !== vault.getSessionRevision()) throw new Error('Vault session changed');
    const envelope = await sealPrivateValue(key, value);
    await browser.storage.local.set({ [key]: envelope });
  });
}

/** Legacy plaintext is replaced at the same key only after encryption succeeds. */
export async function readPrivateCache<T>(key: string): Promise<T | null> {
  if (vault.isLocked()) throw new Error('Vault is locked');
  const revision = vault.getSessionRevision();
  return writes.run(async () => {
    const value = (await browser.storage.local.get(key))[key];
    if (revision !== vault.getSessionRevision()) throw new Error('Vault session changed');
    if (value == null) return null;
    if (!isPrivateEnvelope(value)) {
      const envelope = await sealPrivateValue(key, value);
      await browser.storage.local.set({ [key]: envelope });
      if (revision !== vault.getSessionRevision()) throw new Error('Vault session changed');
      return value as T;
    }
    return openPrivateValue<T>(key, value);
  });
}

export async function removePrivateCache(key: string): Promise<void> {
  await writes.run(() => browser.storage.local.remove(key));
}

export async function openPrivateValue<T>(key: string, value: PrivateEnvelope): Promise<T> {
  return vault.withCacheKey(async cryptoKey => {
      const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToArray(value.iv) as BufferSource, additionalData: aad(key) }, cryptoKey, base64ToArray(value.ciphertext) as BufferSource));
      try { return JSON.parse(new TextDecoder().decode(plaintext)) as T; }
      finally { plaintext.fill(0); }
    });
}

vault.onDestroy(async () => {
  await writes.run(async () => {
    const stored = await browser.storage.local.get(null);
    const keys = Object.keys(stored).filter(key => key === 'activityLog' || key.startsWith(WALLET_DISPLAY_CACHE_PREFIX) || key.startsWith(WALLET_AUTO_BUDGET_PREFIX) || isPrivateEnvelope(stored[key]));
    await browser.storage.local.remove(keys);
    await browser.storage.session.remove(PAYMENT_INTENTS_STORAGE_KEY);
  });
});
