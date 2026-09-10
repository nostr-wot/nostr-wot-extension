import * as vault from '../vault/vault.ts';
import browser from '@lib/browser.ts';
import { PQC_SEED_WORD_COUNT } from '@constants/accounts.ts';
import { countWords } from '@utils/text.ts';
import { bytesToHex, hexToBytes, base64ToArray } from '@lib/crypto/utils.ts';
import { derivePqKeys, pqDecrypt, isPqEnvelope } from '@lib/crypto/pq.ts';
import { mnemonicToSeed } from '@lib/crypto/bip39.ts';
import { nip04Decrypt } from '@lib/crypto/nip04.ts';
import { nip44Decrypt, getConversationKey } from '@lib/crypto/nip44.ts';

/**
 * Derive this account's post-quantum keys from the mnemonic held in the vault.
 *
 * Nothing is stored: the keys are a deterministic function of the seed, so they are
 * recomputed per request rather than persisted. Only 24-word accounts qualify — a
 * 12-word seed carries 128 bits, which would make the seed the limiting factor.
 *
 * The four refusals below carry distinct messages on purpose. `window.nostr.nip44.schemes`
 * advertises what this signer accepts, not what the selected account can do, so a caller
 * that correctly detected `pq` support can still land here — and the only way it can tell
 * the user what to change is if we say which of the four it hit. See
 * `nips/04-nip07-encryption-capability.md`.
 *
 * These strings reach the page, so they disclose the shape of the active account. That is
 * a deliberate and narrow trade: it happens only after the user has approved an encryption
 * request from a connected site, never during the pre-consent capability check, which is
 * exactly why `schemes` is a fixed signer-level array and not derived from the account.
 */
export async function activePqKeys(accountId?: string) {
  if (vault.isLocked()) throw new Error('Vault is locked');
  const activeId = accountId ?? (await browser.storage.local.get(['activeAccountId']) as Record<string, string>).activeAccountId;

  // Imported keys win: an account only holds them when it could not derive, and they
  // are the keys its published attestation advertises. Checking storage first also
  // avoids materializing the mnemonic for accounts that never had one.
  if (vault.hasImportedPqKeys(activeId)) {
    const imported = await vault.withImportedPqKeys(activeId, async ({ kemSecret, dsaSecret, kemPublic, dsaPublic }) => {
      const payload = vault.getDecryptedPayload();
      const acct = payload.accounts.find(a => a.id === activeId);
      if (!acct) throw new Error('No active account');
      // Copies, because withImportedPqKeys zeroes its own as soon as this returns —
      // the caller zeroes these in its own finally block.
      return {
        keys: {
          kem: { publicKey: base64ToArray(kemPublic), secretKey: new Uint8Array(kemSecret) },
          dsa: { publicKey: base64ToArray(dsaPublic), secretKey: new Uint8Array(dsaSecret) },
        },
        pubkey: acct.pubkey,
      };
    });
    if (imported) return imported;
  }

  const payload = vault.getDecryptedPayload();
  const acct = payload.accounts.find(a => a.id === activeId);
  if (!acct) throw new Error('No active account');
  if (acct.readOnly || acct.type === 'npub') {
    throw new Error('This account is watch-only, so it cannot use post-quantum keys');
  }
  // NIP-46 is not checked here: those accounts never reach this function, because
  // handleCryptoRequest refuses them at the routing step via `remoteSignerUnsupported`.
  if (!acct.mnemonic) throw new Error('This account has no seed phrase, so it cannot use post-quantum keys');
  if (countWords(acct.mnemonic) !== PQC_SEED_WORD_COUNT) {
    throw new Error('Post-quantum keys require a 24-word seed phrase');
  }
  const seed = await mnemonicToSeed(acct.mnemonic);
  try {
    return { keys: derivePqKeys(seed, acct.derivationPath ?? acct.derivationIndex ?? 0), pubkey: acct.pubkey };
  } finally {
    seed.fill(0);
  }
}

/** The shared classic/PQ decoder used by page requests and local activity review. */
export async function decryptNip44Content(payload: string, privkey: Uint8Array, peer: Uint8Array, accountId?: string): Promise<string> {
  if (!isPqEnvelope(payload)) return nip44Decrypt(payload, privkey, peer);
  const { keys, pubkey } = await activePqKeys(accountId);
  let conversationKey: Uint8Array | null = null;
  try {
    conversationKey = getConversationKey(privkey, peer);
    return pqDecrypt(payload, keys.kem.secretKey, conversationKey, bytesToHex(peer), pubkey);
  } finally {
    conversationKey?.fill(0);
    keys.kem.secretKey.fill(0);
    keys.dsa.secretKey.fill(0);
  }
}

/** Internal extension review only. Does not switch accounts or change site permissions. */
export async function decryptForAccount(accountId: string, scheme: 'nip04' | 'nip44', peer: string, ciphertext: string): Promise<string> {
  await vault.whenStartupUnlockSettled();
  if (vault.isLocked()) throw new Error('Vault is locked');
  const account = vault.getAccountById(accountId);
  if (!account || account.readOnly || account.type === 'npub') throw new Error('The decryption key is not available on this device');
  if (account.type === 'nip46') throw new Error('This account uses a remote signer; its decryption key is not stored on this device');
  if (!/^[a-f0-9]{64}$/i.test(peer)) throw new Error('Invalid peer public key');
  return vault.withPrivkey(accountId, key => scheme === 'nip04'
    ? nip04Decrypt(ciphertext, key, hexToBytes(peer))
    : decryptNip44Content(ciphertext, key, hexToBytes(peer), accountId));
}