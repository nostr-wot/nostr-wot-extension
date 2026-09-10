import * as vault from '../vault/vault.ts';
import browser from '@lib/browser.ts';
import type { SafeAccount } from '@domain/accounts/types.ts';
import type { UnsignedEvent, SignedEvent } from '@domain/nostr/types.ts';
import { bytesToHex, hexToBytes, randomBytes } from '@lib/crypto/utils.ts';
import { getPublicKey } from '@lib/crypto/secp256k1.ts';
import { BunkerSigner, parseBunkerInput } from 'nostr-tools/nip46';

import { captureAccountSession, assertAccountSession, type AccountSession } from './accountSession.ts';

interface RemoteClient {
  session: AccountSession;
  signer?: BunkerSigner;
  secretKey?: Uint8Array;
  connection: Promise<BunkerSigner>;
  disposed: boolean;
  connected: boolean;
  cancellations: Set<(error: Error) => void>;
}

const _nip46Clients = new Map<string, RemoteClient>();
let lockCleanupRegistered = false;

function assertClient(client: RemoteClient): void {
  if (client.disposed) throw new Error('NIP-46 disconnected');
  assertAccountSession(client.session);
}

async function duringSession<T>(client: RemoteClient, operation: () => Promise<T>): Promise<T> {
  assertClient(client);
  let cancel!: (error: Error) => void;
  const canceled = new Promise<never>((_resolve, reject) => { cancel = reject; });
  client.cancellations.add(cancel);
  try {
    const result = await Promise.race([operation(), canceled]);
    assertClient(client);
    return result;
  } finally { client.cancellations.delete(cancel); }
}

async function initializeClient(acct: SafeAccount, client: RemoteClient): Promise<BunkerSigner> {
  try {
    const remoteAccount = vault.getAccountForRemoteSigning(acct.id);
    if (!remoteAccount) throw new Error('No NIP-46 config');
    const { nip46Config } = remoteAccount;
    const bp = await parseBunkerInput(nip46Config.bunkerUrl);
    assertClient(client);
    if (!bp) throw new Error('Failed to parse bunker URL');
    const secretKey = nip46Config.localPrivkey
      ? hexToBytes(nip46Config.localPrivkey) : randomBytes(32);
    client.secretKey = secretKey;
    if (!nip46Config.localPrivkey) {
      await vault.updateAccountNip46Keys(acct.id, bytesToHex(secretKey), bytesToHex(getPublicKey(secretKey)));
      assertClient(client);
    }
    const signer = BunkerSigner.fromBunker(secretKey, bp, {
      onauth(url: string) {
        try { assertClient(client); } catch { return; }
        if (!url.startsWith('https://')) {
          console.warn('[NIP-46] rejected non-HTTPS auth URL');
          return;
        }
        void browser.tabs.create({ url });
      },
    });
    client.signer = signer;
    await duringSession(client, () => signer.connect());
    assertClient(client);
    client.connected = true;
    return signer;
  } catch (error) {
    if (_nip46Clients.get(acct.id) === client) disconnectNip46(acct.id);
    throw error;
  }
}

async function getNip46Client(acct: SafeAccount, session: AccountSession): Promise<RemoteClient> {
  assertAccountSession(session);
  // Register lazily: vault and signer modules share initialization dependencies.
  if (!lockCleanupRegistered) {
    vault.onSessionInvalidated(() => { for (const id of _nip46Clients.keys()) disconnectNip46(id); });
    lockCleanupRegistered = true;
  }
  let client = _nip46Clients.get(acct.id);
  if (client && client.session.revision !== session.revision) {
    disconnectNip46(acct.id); client = undefined;
  }
  if (!client) {
    client = { session, disposed: false, connected: false, cancellations: new Set(), connection: undefined as unknown as Promise<BunkerSigner> };
    _nip46Clients.set(acct.id, client);
    client.connection = initializeClient(acct, client);
  }
  await client.connection;
  assertClient(client);
  return client;
}

/**
 * Forward a signing/crypto request to the remote NIP-46 signer.
 * NIP-46 ephemeral keys live in memory for the session lifetime (held by BunkerSigner).
 */
export async function handleNip46Request(acct: SafeAccount, method: string, data: unknown, _origin: string): Promise<SignedEvent | string> {
  const session = captureAccountSession(acct.id);
  assertAccountSession(session);
  const client = await getNip46Client(acct, session);
  assertAccountSession(session);
  return duringSession(client, async () => {
    const signer = client.signer!;
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
  });
}

/**
 * Check if a NIP-46 client is currently connected
 */
export function isNip46Connected(accountId: string): boolean {
  const client = _nip46Clients.get(accountId);
  if (!client?.connected) return false;
  try { assertClient(client); return true; }
  catch { disconnectNip46(accountId); return false; }
}

/**
 * Disconnect and remove a NIP-46 client
 */
export function disconnectNip46(accountId: string): void {
  const client = _nip46Clients.get(accountId);
  if (!client) return;
  _nip46Clients.delete(accountId);
  client.disposed = true;
  for (const cancel of client.cancellations) cancel(new Error('NIP-46 disconnected'));
  client.cancellations.clear();
  void client.signer?.close().catch(() => {});
  client.secretKey?.fill(0);
}
