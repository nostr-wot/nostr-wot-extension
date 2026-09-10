/**
 * LNbits auto-provisioning with challenge-response
 *
 * Two-step flow:
 *   1. GET  /api/provision/challenge → { challenge: "<hex>" }
 *   2. POST /api/provision           → { name, event: <signed-kind-27235> }
 *
 * The caller supplies a signFn that signs the challenge as a NIP-98
 * kind:27235 event. The proxy verifies signature + pubkey before
 * creating the wallet via LNbits admin API.
 *
 * @module services/wallet/lnbits-provision
 */

import type { SignedEvent } from '../../domain/nostr/types.ts';

import { secureWalletUrl, walletHttp } from '@services/http/wallet.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4096;
}

async function fetchChallenge(baseUrl: string, fetchFn: typeof fetch): Promise<string> {
  const data = await walletHttp<unknown>(`${baseUrl}/api/provision/challenge`, {}, fetchFn, 'Challenge request failed');
  if (!isRecord(data) || !nonemptyString(data.challenge)) throw new Error('Invalid provisioning challenge');
  return data.challenge;
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
 * @param signFn - Signs a challenge string, returns a kind:27235 SignedEvent
 * @param fetchFn - Optional fetch override for testing
 * @returns The admin key and wallet ID
 */
export async function provisionLnbitsWallet(
  instanceUrl: string,
  walletName: string,
  signFn: (challenge: string) => Promise<SignedEvent>,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<{ adminKey: string; walletId: string; nwcUri?: string }> {
  const baseUrl = secureWalletUrl(instanceUrl);

  const challenge = await fetchChallenge(baseUrl, fetchFn);

  // Step 2: Sign the challenge
  const signedEvent = await signFn(challenge);

  // Step 3: Provision with signed event
  const data = await walletHttp<unknown>(`${baseUrl}/api/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: walletName, event: signedEvent }),
  }, fetchFn, 'Wallet provisioning failed');
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
  signFn: (challenge: string) => Promise<SignedEvent>,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<{ address: string }> {
  const baseUrl = secureWalletUrl(instanceUrl);
  const challenge = await fetchChallenge(baseUrl, fetchFn);
  const signedEvent = await signFn(challenge);
  const data = await walletHttp<unknown>(`${baseUrl}/api/claim-username`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: signedEvent, username }),
  }, fetchFn, 'Claim failed', { serverError: true });
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
  signFn: (challenge: string) => Promise<SignedEvent>,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<void> {
  const baseUrl = secureWalletUrl(instanceUrl);
  const challenge = await fetchChallenge(baseUrl, fetchFn);
  const signedEvent = await signFn(challenge);
  await walletHttp<void>(`${baseUrl}/api/release-username`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: signedEvent }),
  }, fetchFn, 'Release failed', { empty: true });
}
