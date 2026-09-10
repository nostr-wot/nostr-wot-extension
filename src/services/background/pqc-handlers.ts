import type { PqcBlockReason, PqcPanelStatus as PqcStatus } from '@domain/pqc/pqcState.ts';

import { PQC_SEED_WORD_COUNT } from '@constants/accounts.ts';
import { countWords } from '@utils/text.ts';
import { PQC_KIND, IMPORTABLE_REASONS } from '@constants/pqc.ts';

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
 * @module services/background/pqc-handlers
 */

import browser from '../../lib/browser.ts';
import * as vault from '../vault/vault.ts';
import { mnemonicToSeed } from '../../lib/crypto/bip39.ts';
import { arrayToBase64, base64ToArray } from '../../lib/crypto/utils.ts';
import { derivePqKeys, popMessage, signPop, parsePqKeyfile } from '../../lib/crypto/pq.ts';
import { ALG_KEM, ALG_DSA, PQ_PROFILE } from '@constants/crypto/pq.ts';
import { signEvent } from '../../lib/crypto/nip01.ts';
import { broadcastEvent } from './publish-handlers.ts';
import { cachedRelayRead, seedRelayCache, clearRelayCache } from '../relays/relayCache.ts';
import { PQC_PUBLISHED_CACHE } from '@constants/relays.ts';
import { writeLocalCache } from '../relays/relay.ts';
import { readPublishedEvent } from '../relays/readPublishedEvent.ts';
import { config, type HandlerFn } from './state.ts';
import type { UnsignedEvent } from '../../domain/nostr/types.ts';

async function activeAccount() {
  // Never-lock vaults briefly have no decrypted payload on worker startup.
  // Wait for that attempt before deciding whether an actual unlock is needed.
  await vault.whenStartupUnlockSettled();
  if (vault.isLocked()) throw new Error('Vault is locked');
  const payload = vault.getDecryptedPayload();
  const activeId = (
    (await browser.storage.local.get(['activeAccountId'])) as Record<string, string>
  ).activeAccountId;
  return payload.accounts.find((a) => a.id === activeId) ?? null;
}

/** The user's write relays, falling back to the read list when none are flagged. */
async function writeRelays(): Promise<string[]> {
  const relayData = await browser.storage.sync.get(['relays']) as Record<string, string>;
  const flagData = await browser.storage.local.get(['relayFlags']) as Record<
    string,
    Record<string, { read: boolean; write: boolean }>
  >;
  const all = (relayData.relays || '').split(',').map(r => r.trim()).filter(Boolean);
  const flags = flagData.relayFlags || {};
  const writable = all.filter(url => (flags[url] ?? { write: true }).write);
  // storage.sync is empty until the user edits their relay list, so fall back to the
  // in-memory defaults the rest of the extension publishes to.
  return writable.length ? writable : (all.length ? all : config.relays);
}

/**
 * The account's actual post-quantum key pair, secrets included, for export.
 *
 * Mirrors the resolution order in services/signing/signer.ts `activePqKeys`: imported keys
 * win, because an account only holds them when it could not derive, and they are
 * what its published attestation advertises — exporting derived keys for such an
 * account would hand the user a file that decrypts nothing.
 *
 * The caller owns the returned secret bytes and must zero them.
 */
async function activeKeysForExport(): Promise<{
  keys: { kem: { publicKey: Uint8Array; secretKey: Uint8Array }; dsa: { publicKey: Uint8Array; secretKey: Uint8Array } };
  source: 'derived' | 'imported';
}> {
  const acct = await activeAccount();
  if (!acct) throw new Error('No active account');

  if (vault.hasImportedPqKeys(acct.id)) {
    const imported = await vault.withImportedPqKeys(acct.id, async ({ kemSecret, dsaSecret, kemPublic, dsaPublic }) => ({
      // Copies: withImportedPqKeys zeroes its own the moment this returns.
      keys: {
        kem: { publicKey: base64ToArray(kemPublic), secretKey: new Uint8Array(kemSecret) },
        dsa: { publicKey: base64ToArray(dsaPublic), secretKey: new Uint8Array(dsaSecret) },
      },
      source: 'imported' as const,
    }));
    if (imported) return imported;
  }

  if (!acct.mnemonic) throw new Error('This account has no seed phrase, so it has no post-quantum keys to export');
  if (countWords(acct.mnemonic) !== PQC_SEED_WORD_COUNT) {
    throw new Error('Post-quantum keys require a 24-word seed phrase');
  }
  const seed = await mnemonicToSeed(acct.mnemonic);
  try {
    return { keys: derivePqKeys(seed, acct.derivationPath ?? acct.derivationIndex ?? 0), source: 'derived' as const };
  } finally {
    seed.fill(0);
  }
}

/**
 * Build the status for an account carrying imported keys, or null if it has none.
 *
 * The attestation is tagged `origin: independent` and carries NO `seed_strength` tag —
 * the same vocabulary scripts/pqc-keygen.mjs uses for its own independent keys, so a
 * relay reader can tell the two provenances apart. Claiming a seed strength here would
 * be a lie: these keys did not come from the account's seed, and for a 12-word account
 * there is no 256-bit seed to point at in the first place.
 */
async function importedStatus(acct: { id: string; pubkey: string }): Promise<PqcStatus | null> {
  return vault.withImportedPqKeys(acct.id, async ({ kemSecret: _kem, dsaSecret, kemPublic, dsaPublic }) => {
    void _kem;
    const pop = signPop(popMessage(acct.pubkey, kemPublic, dsaPublic), dsaSecret);
    return {
      canDerive: true,
      reason: null,
      wordCount: null,
      pubkey: acct.pubkey,
      keys: { kem: kemPublic, dsa: dsaPublic },
      source: 'imported' as const,
      canImport: false,
      attestation: {
        kind: PQC_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['alg', ALG_KEM, kemPublic],
          ['alg', ALG_DSA, dsaPublic],
          ['origin', 'independent'],
          ['v', PQ_PROFILE],
          ['pop', ALG_DSA, arrayToBase64(pop)],
        ],
        content: '',
      },
    };
  });
}

// Explicitly annotated: several handlers call pqc_getStatus through this same map, and
// without an annotation that self-reference makes the map's type infer as `any`.
export const handlers: Map<string, HandlerFn> = new Map<string, HandlerFn>([
  ['pqc_getStatus', async (): Promise<PqcStatus> => {
    const acct = await activeAccount();
    if (!acct) throw new Error('No active account');

    const blocked = (reason: PqcBlockReason, wordCount: number | null = null): PqcStatus => ({
      canDerive: false, reason, wordCount, pubkey: acct.pubkey, keys: null,
      source: null, canImport: IMPORTABLE_REASONS.has(reason), attestation: null,
    });

    if (acct.readOnly || acct.type === 'npub') return blocked('read-only');
    if (acct.type === 'nip46') return blocked('remote-signer');

    // Imported keys answer for the accounts that cannot derive. Checked before the
    // seed reasons so an account that has already imported reports its keys rather
    // than the explanation of why it cannot derive them.
    const imported = await importedStatus(acct);
    if (imported) return imported;

    if (!acct.mnemonic) return blocked('no-seed');

    const wordCount = countWords(acct.mnemonic);
    if (wordCount !== PQC_SEED_WORD_COUNT) return blocked('short-seed', wordCount);

    const seed = await mnemonicToSeed(acct.mnemonic);
    try {
      const { kem, dsa } = derivePqKeys(seed, acct.derivationPath ?? acct.derivationIndex ?? 0);
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
        source: 'derived',
        canImport: false,
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

  /**
   * Import externally generated post-quantum keys for an account that cannot derive.
   *
   * Restricted to the accounts pqc_getStatus reports as importable: offering this to a
   * read-only or NIP-46 account would store secrets that nothing could ever use, and
   * offering it to a 24-word account would replace keys recoverable from the seed with
   * keys that are not.
   */
  ['pqc_importKeys', async (params) => {
    const acct = await activeAccount();
    if (!acct) throw new Error('No active account');

    const status = (await handlers.get('pqc_getStatus')!({})) as PqcStatus;
    if (!status.canImport) {
      throw new Error(
        status.source
          ? 'This account already has post-quantum keys'
          : 'This account cannot use imported post-quantum keys',
      );
    }

    // Throws with a specific message when the file is malformed or the pairs do not
    // match each other. Nothing is stored unless both pairs prove themselves.
    const keys = parsePqKeyfile(params.keyfile as string);
    try {
      await vault.setImportedPqKeys(acct.id, keys, PQ_PROFILE);
    } finally {
      keys.kem.secretKey.fill(0);
      keys.dsa.secretKey.fill(0);
    }
    await clearRelayCache(acct.pubkey, [PQC_PUBLISHED_CACHE]);
    return handlers.get('pqc_getStatus')!({}) as Promise<PqcStatus>;
  }],

  /**
   * Export the account's post-quantum key file — SECRET KEYS INCLUDED.
   *
   * This is the only way to get a derived key off the device, and for an
   * imported key it is the only way to make a second copy of the one thing in
   * this extension a seed phrase cannot restore. Without it, "your seed phrase
   * cannot restore this key" was advice with nothing the user could act on.
   *
   * The shape is exactly what `parsePqKeyfile` accepts, so a file exported here
   * imports here — the round trip is the format's only real specification, and
   * generating something our own importer would reject is the obvious way to
   * get this wrong.
   *
   * Privileged by construction: every handler in this map is gated to internal
   * extension pages (background.ts derives PRIVILEGED_METHODS from the maps), so
   * no web page can call it. It still refuses on a locked vault, because the
   * secrets are not in memory then and asking is the wrong shape of request.
   */
  ['pqc_exportKeys', async () => {
    const acct = await activeAccount();
    if (!acct) throw new Error('No active account');

    const { keys, source } = await activeKeysForExport();
    try {
      return {
        source,
        filename: `nostr-wot-pq-keys-${acct.pubkey.slice(0, 8)}.json`,
        keyfile: JSON.stringify({
          v: PQ_PROFILE,
          alg: { kem: ALG_KEM, dsa: ALG_DSA },
          kem: {
            public: arrayToBase64(keys.kem.publicKey),
            secret: arrayToBase64(keys.kem.secretKey),
          },
          dsa: {
            public: arrayToBase64(keys.dsa.publicKey),
            secret: arrayToBase64(keys.dsa.secretKey),
          },
        }, null, 2),
      };
    } finally {
      // The copies this handler holds. withImportedPqKeys already zeroed its own.
      keys.kem.secretKey.fill(0);
      keys.dsa.secretKey.fill(0);
    }
  }],

  /** Remove imported keys, so a wrong key file is not a permanent state. */
  ['pqc_removeImportedKeys', async () => {
    const acct = await activeAccount();
    if (!acct) throw new Error('No active account');
    const removed = await vault.clearImportedPqKeys(acct.id);
    return { removed };
  }],

  /**
   * Sign and publish the kind:10203 attestation.
   *
   * Without this the feature is only half usable: a user can hold post-quantum keys but
   * nobody can send to them, because a sender learns the ML-KEM key from this event and
   * from nowhere else. Copying JSON into another tool is not a real answer.
   */
  ['pqc_publishAttestation', async () => {
    const status = (await handlers.get('pqc_getStatus')!({})) as PqcStatus;
    if (!status.canDerive || !status.attestation) {
      throw new Error('This account cannot publish post-quantum keys');
    }

    const relays = await writeRelays();
    if (relays.length === 0) throw new Error('No relays configured');

    // withPrivkey zeroes the key on every path. The previous version held a bare
    // getPrivkey() copy across the signing AND the relay broadcast, and never zeroed
    // it — not on success, not when a relay rejected the event.
    const signed = await vault.withPrivkey(undefined, (privkey) =>
      signEvent(status.attestation as UnsignedEvent, privkey));

    const { sent, failed } = await broadcastEvent(signed, relays);
    if (sent === 0) throw new Error('No relay accepted the attestation');

    await writeLocalCache(signed);
    await seedRelayCache(PQC_PUBLISHED_CACHE, status.pubkey!, { published: true, current: true });
    return { sent, failed, relays: relays.length, eventId: signed.id };
  }],

  /**
   * Is an attestation already on the user's relays, and does it match the current keys?
   *
   * Answered by querying relays rather than a local flag, so it stays correct when the
   * attestation was published from another device — or when it was never really accepted.
   */
  ['pqc_checkPublished', async () => {
    const status = (await handlers.get('pqc_getStatus')!({})) as PqcStatus;
    if (!status.canDerive || !status.pubkey) return { published: false, current: false };
    const pubkey = status.pubkey;

    // Served from the last real answer so the home card paints immediately; the
    // relays are asked behind and `storage.onChanged` corrects it. An
    // unreachable read is never cached, so a stale value is always something
    // the relays genuinely said. See services/relays/relayCache.ts.
    return await cachedRelayRead(PQC_PUBLISHED_CACHE, pubkey, async () => {
      const relays = await writeRelays();
      return checkPqcPublication(status, relays);
    });
  }],
]);

/** Shared verified reader keeps newest publication evidence through outages. */
export async function checkPqcPublication(status: Pick<PqcStatus, 'pubkey' | 'keys'>, relays: string[]) {
  if (!status.pubkey) return { published: false, current: false };
  try {
    const result = await readPublishedEvent(status.pubkey, PQC_KIND, relays);
    if (!result.event) return { published: false, current: false, ...(!result.reachable && { unreachable: true }) };
    const kem = result.event.tags.find(tag => tag[0] === 'alg' && tag[1] === ALG_KEM)?.[2];
    const dsa = result.event.tags.find(tag => tag[0] === 'alg' && tag[1] === ALG_DSA)?.[2];
    return { published: true, current: kem === status.keys?.kem && dsa === status.keys?.dsa };
  } catch {
    return { published: false, current: false, unreachable: true };
  }
}
