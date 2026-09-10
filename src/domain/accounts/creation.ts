import { GENERATED_MNEMONIC_STRENGTH_BITS } from '@constants/accounts.ts';
/**
 * Multi-Account Manager
 *
 * Creates, imports, and manages Nostr identity accounts of various types:
 *   - generated: New keys from BIP-39 mnemonic via NIP-06 derivation path
 *   - nsec: Imported private key (nsec bech32 or hex)
 *   - npub: Read-only public key (no signing capability)
 *   - nip46: Remote signer via Nostr Connect (bunker:// URL)
 *   - external: Delegates to another NIP-07 extension
 *
 * All account types are stored in the encrypted vault. Only the active account's
 * pubkey is mirrored into the background config / `storage.sync.myPubkey` as the
 * canonical "current identity" pointer used by the signer and activity log.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/06.md -- NIP-06: Key derivation from mnemonic (m/44'/1237'/0'/0/0)
 * @see https://github.com/nostr-protocol/nips/blob/master/19.md -- NIP-19: bech32 entities (nsec, npub)
 * @see https://github.com/nostr-protocol/nips/blob/master/46.md -- NIP-46: Nostr Connect (remote signing)
 *
 * @module domain/accounts/creation
 */

import type { Account } from './types.ts';
import { getPublicKey } from '../../lib/crypto/secp256k1.ts';
import { bytesToHex, hexToBytes } from '../../lib/crypto/utils.ts';
import { nsecDecode, npubDecode } from '../../lib/crypto/bech32.ts';
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '../../lib/crypto/bip39.ts';
import { derivePath } from '../../lib/crypto/bip32.ts';
import { normalizeDerivationPath, standardDerivationIndex } from './derivation.ts';
import { MAX_BIP32_INDEX, NIP06_ACCOUNT_PREFIX, NIP06_PATH } from '@constants/crypto/bip32.ts';

function generateId(): string {
  const arr = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a new account from a mnemonic (NIP-06 derivation)
 * @param mnemonic - 12 or 24 word mnemonic
 * @param name - Account display name
 * @returns Account object
 */
export async function createFromMnemonic(mnemonic: string, name: string = 'Main'): Promise<Account> {
  return createFromMnemonicAtPath(mnemonic, NIP06_PATH, name);
}

/**
 * Create a sub-account from an existing mnemonic at a specific HD derivation index.
 * Derives from m/44'/1237'/0'/0/{index} per NIP-06.
 * @param mnemonic - existing 12 or 24 word mnemonic
 * @param index - derivation index (0 = first account, 1 = second, etc.)
 * @param name - Account display name
 * @returns Account object with derivationIndex set
 */
export async function createFromMnemonicAtIndex(mnemonic: string, index: number, name?: string): Promise<Account> {
  if (!Number.isInteger(index) || index < 0 || index > MAX_BIP32_INDEX) throw new Error('Invalid derivation index');
  return createFromMnemonicAtPath(mnemonic, NIP06_ACCOUNT_PREFIX + index, name || `Account ${index + 1}`);
}

/** Derive an identity from the seed with a validated, persisted recovery path. */
export async function createFromMnemonicAtPath(mnemonic: string, requestedPath: string, name = 'Custom account'): Promise<Account> {
  const path = normalizeDerivationPath(requestedPath);
  if (!path) throw new Error('Invalid derivation path');
  const index = standardDerivationIndex(path);
  const valid = await validateMnemonic(mnemonic);
  if (!valid) throw new Error('Invalid mnemonic');

  const seed = await mnemonicToSeed(mnemonic);
  let privkey: Uint8Array | null = null;
  try {
    privkey = await derivePath(seed, path);
    const pubkey = getPublicKey(privkey);

    return {
      id: generateId(),
      name,
      type: 'generated',
      pubkey: bytesToHex(pubkey),
      privkey: bytesToHex(privkey),
      mnemonic,
      nip46Config: null,
      readOnly: false,
      createdAt: Math.floor(Date.now() / 1000),
      derivationPath: path,
      ...(index !== null ? { derivationIndex: index } : {})
    };
  } finally {
    seed.fill(0);
    if (privkey) privkey.fill(0);
  }
}

/**
 * Generate a new mnemonic and create an account
 * @param name
 * @returns Object with account and mnemonic
 */
export async function generateNewAccount(name: string = 'Main'): Promise<{ account: Account; mnemonic: string }> {
  // 256-bit entropy (24 words). A 12-word phrase carries only 128 bits, which
  // becomes the limiting factor once post-quantum keys are derived from the same
  // seed — the seed, not the algorithm, would be the weakest link. Existing
  // 12-word accounts keep working; this affects newly generated identities only.
  const mnemonic = await generateMnemonic(GENERATED_MNEMONIC_STRENGTH_BITS); // 24 words
  const account = await createFromMnemonic(mnemonic, name);
  return { account, mnemonic };
}

/**
 * Import only the first derived key from a mnemonic (no mnemonic stored).
 * Used when a main seed already exists and we only want the key, not the seed.
 * @param mnemonic - 12 or 24 word mnemonic
 * @param name - Account display name
 * @returns Account object with type 'nsec' (no mnemonic field)
 */
export async function importFromMnemonicDerived(mnemonic: string, name: string = 'Imported'): Promise<Account> {
  const valid = await validateMnemonic(mnemonic);
  if (!valid) throw new Error('Invalid mnemonic');

  const seed = await mnemonicToSeed(mnemonic);
  let privkey: Uint8Array | null = null;
  try {
    privkey = await derivePath(seed, NIP06_PATH);
    const pubkey = getPublicKey(privkey);

    return {
      id: generateId(),
      name,
      type: 'nsec',
      pubkey: bytesToHex(pubkey),
      privkey: bytesToHex(privkey),
      mnemonic: null,
      nip46Config: null,
      readOnly: false,
      createdAt: Math.floor(Date.now() / 1000)
    };
  } finally {
    seed.fill(0);
    if (privkey) privkey.fill(0);
  }
}

/**
 * Import an account from an nsec or hex private key
 * @param input - nsec1... or 64-char hex
 * @param name
 * @returns Account object
 */
export async function importNsec(input: string, name: string = 'Imported'): Promise<Account> {
  let privkeyHex: string;

  if (input.startsWith('nsec1')) {
    privkeyHex = nsecDecode(input);
  } else if (/^[0-9a-f]{64}$/i.test(input)) {
    privkeyHex = input.toLowerCase();
  } else {
    throw new Error('Invalid nsec or hex private key');
  }

  const privkeyBytes = hexToBytes(privkeyHex);
  let pubkey: Uint8Array;
  try {
    pubkey = getPublicKey(privkeyBytes);
  } finally {
    privkeyBytes.fill(0);
  }

  return {
    id: generateId(),
    name,
    type: 'nsec',
    pubkey: bytesToHex(pubkey),
    privkey: privkeyHex,
    mnemonic: null,
    nip46Config: null,
    readOnly: false,
    createdAt: Math.floor(Date.now() / 1000)
  };
}

/**
 * Import a read-only account from an npub or hex pubkey
 * @param input - npub1... or 64-char hex
 * @param name
 * @returns Account object
 */
export function importNpub(input: string, name: string = 'Watch-only'): Account {
  let pubkeyHex: string;

  if (input.startsWith('npub1')) {
    pubkeyHex = npubDecode(input);
  } else if (/^[0-9a-f]{64}$/i.test(input)) {
    pubkeyHex = input.toLowerCase();
  } else {
    throw new Error('Invalid npub or hex public key');
  }

  return {
    id: generateId(),
    name,
    type: 'npub',
    pubkey: pubkeyHex,
    privkey: null,
    mnemonic: null,
    nip46Config: null,
    readOnly: true,
    createdAt: Math.floor(Date.now() / 1000)
  };
}

/**
 * Create a NIP-46 (Nostr Connect) account stub
 * @param bunkerUrl - bunker://pubkey?relay=...&secret=...
 * @param name
 * @returns Account object
 */
export function connectNip46(bunkerUrl: string, name: string = 'Bunker'): Account {
  // Parse bunker URL
  const url = new URL(bunkerUrl);
  const pubkey = url.hostname || url.pathname.replace('//', '');
  const relay = url.searchParams.get('relay');
  const secret = url.searchParams.get('secret');

  if (!pubkey || pubkey.length !== 64) {
    throw new Error('Invalid bunker URL: missing pubkey');
  }

  return {
    id: generateId(),
    name,
    type: 'nip46',
    pubkey,
    privkey: null,
    mnemonic: null,
    nip46Config: { bunkerUrl, relay, secret },
    readOnly: false,
    createdAt: Math.floor(Date.now() / 1000)
  };
}

/**
 * Create a NIP-46 account from a nostrconnect:// QR flow
 * @param signerPubkey - hex pubkey of the remote signer
 * @param relay - relay URL used for communication
 * @param localPrivkey - hex ephemeral private key (for reconnection)
 * @param localPubkey - hex ephemeral public key
 * @param name
 * @returns Account object
 */
export function connectNostrConnect(signerPubkey: string, relay: string, localPrivkey: string, localPubkey: string, name: string = 'Nostr Connect'): Account {
  return {
    id: generateId(),
    name,
    type: 'nip46',
    pubkey: signerPubkey,
    privkey: null,
    mnemonic: null,
    nip46Config: {
      bunkerUrl: `bunker://${signerPubkey}?relay=${encodeURIComponent(relay)}`,
      relay,
      secret: null,
      localPrivkey,
      localPubkey,
    },
    readOnly: false,
    createdAt: Math.floor(Date.now() / 1000)
  };
}
