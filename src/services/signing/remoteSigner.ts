import * as vault from '../vault/vault.ts';
import browser from '@lib/browser.ts';
import type { SafeAccount } from '@domain/accounts/types.ts';
import type { UnsignedEvent, SignedEvent } from '@domain/nostr/types.ts';
import { bytesToHex, hexToBytes, randomBytes } from '@lib/crypto/utils.ts';
import { getPublicKey } from '@lib/crypto/secp256k1.ts';
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';

// NIP-46 client instances (keyed by account ID)
const _nip46Clients: Map<string, BunkerSigner> = new Map();

// -- NIP-46 Remote Signer (nostr-tools BunkerSigner) --

async function getNip46Client(acct: SafeAccount): Promise<BunkerSigner> {
  if (_nip46Clients.has(acct.id)) {
    return _nip46Clients.get(acct.id)!;
  }

  if (!acct.nip46Config) throw new Error('No NIP-46 config');

  // Parse bunker URL to get { pubkey, relays, secret }
  const bp = await parseBunkerInput(acct.nip46Config.bunkerUrl);
  if (!bp) throw new Error('Failed to parse bunker URL');

  // Restore persisted keypair or generate a new one
  let secretKey: Uint8Array;
  if (acct.nip46Config.localPrivkey) {
    secretKey = hexToBytes(acct.nip46Config.localPrivkey);
  } else {
    secretKey = randomBytes(32);
    // Persist the new keypair for reconnection after service worker restart
    const pubkey = bytesToHex(getPublicKey(secretKey));
    const privkeyHex = bytesToHex(secretKey);
    try {
      await vault.updateAccountNip46Keys(acct.id, privkeyHex, pubkey);
    } catch (e) {
      console.warn('[NIP-46] failed to persist keypair:', (e as Error).message);
    }
  }

  // Create BunkerSigner with auth_url handler (critical for nsec.app)
  const signer = BunkerSigner.fromBunker(secretKey, bp, {
    onauth(url: string) {
      // E2: Only allow https:// auth URLs to prevent javascript:/data: injection
      if (!url.startsWith('https://')) {
        console.warn('[NIP-46] rejected non-HTTPS auth_url:', url);
        return;
      }
      console.debug('[NIP-46] auth_url received, opening:', url);
      void browser.tabs.create({ url });
    }
  });

  // Send "connect" RPC to establish session
  await signer.connect();

  _nip46Clients.set(acct.id, signer);
  return signer;
}

/**
 * Forward a signing/crypto request to the remote NIP-46 signer.
 * NIP-46 ephemeral keys live in memory for the session lifetime (held by BunkerSigner).
 */
export async function handleNip46Request(acct: SafeAccount, method: string, data: unknown, _origin: string): Promise<SignedEvent | string> {
  const signer = await getNip46Client(acct);

  switch (method) {
    case 'signEvent':
      return signer.signEvent(data as UnsignedEvent);
    case 'nip04Encrypt': {
      const { pubkey, plaintext } = data as { pubkey: string; plaintext: string };
      return signer.nip04Encrypt(pubkey, plaintext);
    }
    case 'nip04Decrypt': {
      const { pubkey, ciphertext } = data as { pubkey: string; ciphertext: string };
      return signer.nip04Decrypt(pubkey, ciphertext);
    }
    case 'nip44Encrypt': {
      const { pubkey, plaintext } = data as { pubkey: string; plaintext: string };
      return signer.nip44Encrypt(pubkey, plaintext);
    }
    case 'nip44Decrypt': {
      const { pubkey, ciphertext } = data as { pubkey: string; ciphertext: string };
      return signer.nip44Decrypt(pubkey, ciphertext);
    }
    default:
      throw new Error(`Unsupported NIP-46 method: ${method}`);
  }
}

/**
 * Check if a NIP-46 client is currently connected
 */
export function isNip46Connected(accountId: string): boolean {
  return _nip46Clients.has(accountId);
}

/**
 * Disconnect and remove a NIP-46 client
 */
export function disconnectNip46(accountId: string): void {
  const client = _nip46Clients.get(accountId);
  if (client) {
    client.close().catch(() => {});
    _nip46Clients.delete(accountId);
  }
}