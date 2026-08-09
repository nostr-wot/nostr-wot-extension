/**
 * Post-quantum key handlers.
 *
 * Reports whether the active account can hold post-quantum keys, and derives them
 * on demand.
 *
 * Nothing is stored. The keys are a deterministic function of the mnemonic already in
 * the vault, so they can be recomputed whenever they are needed — which means no vault
 * migration, and no additional secret material at rest. Derivation costs a few
 * milliseconds and only happens when the user opens the post-quantum panel.
 *
 * Only a 24-word mnemonic may derive. A 12-word phrase carries 128 bits of entropy,
 * which would become the weakest link, so those accounts are told they can add an
 * independent key instead rather than being handed a weak one that looks strong.
 *
 * @see docs/security.md
 * @module lib/bg/pqc-handlers
 */

import browser from '../browser.ts';
import * as vault from '../vault.ts';
import { mnemonicToSeed } from '../crypto/bip39.ts';
import { arrayToBase64 } from '../crypto/utils.ts';
import {
  derivePqKeys, popMessage, signPop,
  ALG_KEM, ALG_DSA, PQ_PROFILE,
} from '../crypto/pq.ts';
import type { HandlerFn } from './state.ts';

/** Replaceable kind carrying post-quantum public keys. See the proposed NIP. */
export const PQC_KIND = 10203;

/** Why an account cannot derive post-quantum keys from its seed. */
export type PqcBlockReason =
  | 'read-only'      // npub-only, no signing capability at all
  | 'remote-signer'  // NIP-46: the protocol has no post-quantum operations
  | 'no-seed'        // imported from an nsec; there is no mnemonic to derive from
  | 'short-seed';    // 12 words: 128 bits would be the weakest link

export type PqcStatus = {
  canDerive: boolean;
  reason: PqcBlockReason | null;
  wordCount: number | null;
  pubkey: string | null;
  keys: { kem: string; dsa: string } | null;
  /** Unsigned attestation, ready for the caller to sign and publish. */
  attestation: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  } | null;
};

async function activeAccount() {
  if (vault.isLocked()) throw new Error('Vault is locked');
  const payload = vault.getDecryptedPayload();
  const activeId = (
    (await browser.storage.local.get(['activeAccountId'])) as Record<string, string>
  ).activeAccountId;
  return payload.accounts.find((a) => a.id === activeId) ?? null;
}

export const handlers = new Map<string, HandlerFn>([
  ['pqc_getStatus', async (): Promise<PqcStatus> => {
    const acct = await activeAccount();
    if (!acct) throw new Error('No active account');

    const blocked = (reason: PqcBlockReason, wordCount: number | null = null): PqcStatus => ({
      canDerive: false, reason, wordCount, pubkey: acct.pubkey, keys: null, attestation: null,
    });

    if (acct.readOnly || acct.type === 'npub') return blocked('read-only');
    if (acct.type === 'nip46') return blocked('remote-signer');
    if (!acct.mnemonic) return blocked('no-seed');

    const wordCount = acct.mnemonic.trim().split(/\s+/).length;
    if (wordCount !== 24) return blocked('short-seed', wordCount);

    const seed = await mnemonicToSeed(acct.mnemonic);
    try {
      const { kem, dsa } = derivePqKeys(seed, acct.derivationIndex ?? 0);
      const kemB64 = arrayToBase64(kem.publicKey);
      const dsaB64 = arrayToBase64(dsa.publicKey);
      const pop = signPop(popMessage(acct.pubkey, kemB64, dsaB64), dsa.secretKey);

      // Secret key material is not returned and does not leave this scope.
      kem.secretKey.fill(0);
      dsa.secretKey.fill(0);

      return {
        canDerive: true,
        reason: null,
        wordCount,
        pubkey: acct.pubkey,
        keys: { kem: kemB64, dsa: dsaB64 },
        attestation: {
          kind: PQC_KIND,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['alg', ALG_KEM, kemB64],
            ['alg', ALG_DSA, dsaB64],
            ['origin', 'derived'],
            ['seed_strength', '256'],
            ['v', PQ_PROFILE],
            ['pop', ALG_DSA, arrayToBase64(pop)],
          ],
          content: '',
        },
      };
    } finally {
      seed.fill(0);
    }
  }],
]);
