/** Wallet provisioning and address mutations use body-bound NIP-98 v2 transactions. */
import type { SignedEvent } from '../../domain/nostr/types.ts';

import { secureWalletUrl, walletHttp } from '@services/http/wallet.ts';
import { bytesToHex, sha256 } from '@lib/crypto/utils.ts';

export interface WalletAuthProof { challenge: string; payload: string; transaction: string; }
export type WalletAuthSigner = (proof: WalletAuthProof) => Promise<SignedEvent>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
}

/** Serialize once: the hash covers exactly the bytes sent, without a self-containing event. */
async function authenticatedRequest<T>(
  baseUrl: string, operation: 'provision' | 'claim-username' | 'release-username',
  data: Record<string, unknown>, signFn: WalletAuthSigner, fetchFn: typeof fetch,
  errorPrefix: string, options: {serverError?: boolean; empty?: boolean} = {},
): Promise<T> {
  const url = `${baseUrl}/api/v2/${operation}`;
  const body = JSON.stringify(data);
  const payload = bytesToHex(await sha256(new TextEncoder().encode(body)));
  const challenge = await walletHttp<unknown>(`${baseUrl}/api/v2/provision/challenge`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({url, method:'POST', payload}),
  }, fetchFn, 'Secure wallet authentication v2 challenge request failed (backend upgrade may be required)');
  const now = Math.floor(Date.now()/1000);
  if (!isRecord(challenge) || challenge.version !== 2
      || typeof challenge.challenge !== 'string' || !/^[a-f0-9]{64}$/.test(challenge.challenge)
      || typeof challenge.transactionToken !== 'string' || !/^[a-f0-9]{64}$/.test(challenge.transactionToken)
      || !Number.isSafeInteger(challenge.expiresAt) || (challenge.expiresAt as number) <= now
      || (challenge.expiresAt as number) > now + 120) {
    throw new Error('Invalid v2 provisioning challenge; a compatible backend is required');
  }
  const transaction = bytesToHex(await sha256(new TextEncoder().encode(challenge.transactionToken)));
  const signed = await signFn({challenge:challenge.challenge, payload, transaction});
  if ((challenge.expiresAt as number) <= Math.floor(Date.now()/1000)) throw new Error('Wallet authentication challenge expired');
  return walletHttp<T>(url, {
    method:'POST', headers:{'Content-Type':'application/json',
      Authorization:`Nostr ${btoa(JSON.stringify(signed))}`, 'X-Nostr-Transaction':challenge.transactionToken},
    body,
  }, fetchFn, errorPrefix, options);
}

function parseAddress(data: unknown): string | null {
  if (!isRecord(data) || !(data.address === null || (nonemptyString(data.address) && /^[^@\s]+@[^@\s]+$/.test(data.address)))) {
    throw new Error('Invalid Lightning Address response');
  }
  return data.address;
}

/**
 * Create a new wallet via the provisioning proxy.
 *
 * @param instanceUrl - The provisioning server base URL
 * @param walletName - Name for the new wallet (e.g. "WoT:npub1abc...")
 * @param signFn - Signs the challenge, body hash and transaction hash for the fixed endpoint
 * @param fetchFn - Optional fetch override for testing
 * @returns The admin key and wallet ID
 */
export async function provisionLnbitsWallet(
  instanceUrl: string,
  walletName: string,
  signFn: WalletAuthSigner,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<{ adminKey: string; walletId: string; nwcUri?: string }> {
  const baseUrl = secureWalletUrl(instanceUrl);

  const data = await authenticatedRequest<unknown>(baseUrl, 'provision', {name:walletName}, signFn, fetchFn, 'Wallet provisioning failed');
  if (!isRecord(data) || !nonemptyString(data.adminkey) || !nonemptyString(data.id)
      || (data.nwcUri !== undefined && (!nonemptyString(data.nwcUri) || !data.nwcUri.startsWith('nostr+walletconnect://')))) {
    throw new Error('Invalid wallet provisioning response');
  }
  return { adminKey: data.adminkey, walletId: data.id, nwcUri: data.nwcUri as string | undefined };
}

/**
 * Claim a Lightning Address username via the provisioning proxy.
 *
 * Uses the same challenge-response auth as provisioning.
 */
export async function claimLightningAddress(
  instanceUrl: string,
  username: string,
  signFn: WalletAuthSigner,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<{ address: string }> {
  const baseUrl = secureWalletUrl(instanceUrl);
  const data = await authenticatedRequest<unknown>(baseUrl, 'claim-username', {username}, signFn, fetchFn, 'Claim failed', {serverError:true});
  const address = parseAddress(data);
  if (address === null) throw new Error('Invalid Lightning Address claim response');
  return { address };
}

/**
 * Look up the Lightning Address for a pubkey (public, no auth needed).
 */
export async function getLightningAddress(
  instanceUrl: string,
  pubkey: string,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<string | null> {
  const baseUrl = secureWalletUrl(instanceUrl);
  const data = await walletHttp<unknown>(`${baseUrl}/api/lightning-address?pubkey=${encodeURIComponent(pubkey)}`, {}, fetchFn, 'Lightning Address lookup failed');
  return parseAddress(data);
}

/**
 * Release a claimed Lightning Address (authenticated).
 */
export async function releaseLightningAddress(
  instanceUrl: string,
  signFn: WalletAuthSigner,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<void> {
  const baseUrl = secureWalletUrl(instanceUrl);
  await authenticatedRequest<void>(baseUrl, 'release-username', {}, signFn, fetchFn, 'Release failed', {empty:true});
}
