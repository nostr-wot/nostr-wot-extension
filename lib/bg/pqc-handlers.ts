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
  derivePqKeys, popMessage, signPop, parsePqKeyfile,
  ALG_KEM, ALG_DSA, PQ_PROFILE,
} from '../crypto/pq.ts';
import { signEvent } from '../crypto/nip01.ts';
import { broadcastEvent } from './publish-handlers.ts';
import { liveQuery } from '../relay.ts';
import { config, type HandlerFn } from './state.ts';
import type { UnsignedEvent } from '../types.ts';

/** Where the last relay answer is kept, so the dashboard never has to ask the network. */
const PUBLISH_CACHE_KEY = 'pqcPublishState';

interface PublishCache {
  pubkey: string;
  published: boolean;
  current: boolean;
  at: number;
}

async function cachePublishState(pubkey: string, r: { published: boolean; current: boolean }): Promise<void> {
  try {
    await browser.storage.local.set({ [PUBLISH_CACHE_KEY]: { pubkey, ...r, at: Date.now() } });
  } catch { /* the answer is still returned; caching is best-effort */ }
}

/** Replaceable kind carrying post-quantum public keys. See the proposed NIP. */
export const PQC_KIND = 10203;

/** Why an account cannot derive post-quantum keys from its seed. */
export type PqcBlockReason =
  | 'read-only'      // npub-only, no signing capability at all
  | 'remote-signer'  // NIP-46: the protocol has no post-quantum operations
  | 'no-seed'        // imported from an nsec; there is no mnemonic to derive from
  | 'short-seed';    // 12 words: 128 bits would be the weakest link

/**
 * Which blocked accounts may import keys instead.
 *
 * A read-only account can sign nothing, so it could neither publish an attestation nor
 * take part in the hybrid key agreement — post-quantum decryption needs the classical
 * private key too. A NIP-46 account's nip44 traffic is routed to the bunker, which knows
 * nothing about our envelope, so imported keys would sit unused. The other two blocked
 * reasons describe accounts that hold a perfectly good secp256k1 key and merely have no
 * mnemonic to derive from — exactly what an imported key is for.
 */
const IMPORTABLE_REASONS: ReadonlySet<PqcBlockReason> = new Set<PqcBlockReason>(['no-seed', 'short-seed']);

export type PqcStatus = {
  canDerive: boolean;
  reason: PqcBlockReason | null;
  wordCount: number | null;
  pubkey: string | null;
  keys: { kem: string; dsa: string } | null;
  /** Where the keys came from. null when the account has none. */
  source: 'derived' | 'imported' | null;
  /** True when this account has no keys but may import them. */
  canImport: boolean;
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
    return handlers.get('pqc_getStatus')!({}) as Promise<PqcStatus>;
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

    return { sent, failed, relays: relays.length, eventId: signed.id };
  }],

  /**
   * The last relay answer, without asking the relays.
   *
   * The dashboard card needs to know whether post-quantum keys are published, and it is
   * rendered on every popup open. Asking the relays there meant a WebSocket round trip to
   * every write relay each time the popup opened — which is why the popup could take tens
   * of seconds to become usable and why the console filled with socket-state noise. The
   * card reads this instead; the panel refreshes it when the user actually opens it.
   */
  ['pqc_getPublishedCached', async () => {
    const acct = await activeAccount();
    if (!acct) return null;
    const data = await browser.storage.local.get(PUBLISH_CACHE_KEY) as Record<string, PublishCache | undefined>;
    const cached = data[PUBLISH_CACHE_KEY];
    // Tied to the pubkey: another account's answer is not this account's answer.
    if (!cached || cached.pubkey !== acct.pubkey) return null;
    return { published: cached.published, current: cached.current, at: cached.at };
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

    const relays = await writeRelays();
    let found: { tags: string[][] } | null = null;
    try {
      for await (const ev of liveQuery(
        [{ kinds: [PQC_KIND], authors: [status.pubkey], limit: 1 }],
        relays,
        { closeOnExhaust: true },
      )) {
        const e = (ev as { event?: { tags: string[][] } }).event;
        if (e) { found = e; break; }
      }
    } catch {
      return { published: false, current: false };
    }

    if (!found) {
      await cachePublishState(status.pubkey, { published: false, current: false });
      return { published: false, current: false };
    }

    // Published is not enough: if the keys rotated, what is out there is stale and
    // senders would encrypt to a key this account no longer uses.
    const kemTag = found.tags.find(t => t[0] === 'alg' && t[1] === ALG_KEM);
    const result = { published: true, current: kemTag?.[2] === status.keys?.kem };
    await cachePublishState(status.pubkey, result);
    return result;
  }],
]);
