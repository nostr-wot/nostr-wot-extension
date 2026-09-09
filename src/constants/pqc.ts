import type { PqcBlockReason } from '@domain/pqc/pqcState.ts';
/** Replaceable kind carrying post-quantum public keys. See the proposed NIP. */
export const PQC_KIND = 10203;

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
export const IMPORTABLE_REASONS: ReadonlySet<PqcBlockReason> = new Set<PqcBlockReason>(['no-seed', 'short-seed']);

/**
 * Step-by-step guide, linked from the panel. Kept as one constant so it is changed in one
 * place rather than hunted through six locale files.
 *
 * Points at the extension-facing guide, not the command-line one: someone who tapped this
 * link is in the popup, not at a terminal. English only on the site today (next-intl is
 * configured `localePrefix: 'as-needed'`, so the default locale is unprefixed and this URL
 * resolves). Linking the unprefixed English page from every locale is deliberate — it
 * exists, whereas /es/guides/... does not.
 */

/** Remembers that the explainer has been shown once, so it does not reappear every visit. */
export const PQC_HOW_SEEN_KEY = 'pqcHowItWorksSeen';

export const PQC_GUIDE_URL = 'https://nostr-wot.com/guides/turn-on-post-quantum-keys';

export const KEYGEN_SOURCE_URL =
  'https://github.com/nostr-wot/nostr-wot-extension/blob/main/scripts/pqc-keygen.mjs';

export const KEYGEN_COMMAND = 'npm run pqc:keygen -- --independent --keyfile keys.json';
