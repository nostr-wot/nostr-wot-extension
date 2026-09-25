import { detectImportKind } from '@nostr-wot/accounts';

export type ImportType = 'ncryptsec' | 'nsec' | 'mnemonic' | 'pqc' | null;

/**
 * Classify pasted key material for import routing and UI hints.
 *
 * Shape only: a recognized format is not proof of a valid checksum, key or mnemonic, and
 * the account and crypto services must still validate before accepting it. That is
 * deliberate — with strict parsing alone, a seed phrase with one mistyped word is
 * indistinguishable from random text, and the only message available is "unrecognized
 * input" at the exact moment someone is recovering an identity.
 *
 * Layered on `@nostr-wot/accounts`' `detectImportKind`, with two differences that are this
 * extension's and not the shared layer's:
 *
 *   - the post-quantum key FILE, a JSON object, which is not key material any signer
 *     protocol knows about;
 *   - `npub` and `bunker` report no hint here, because this wizard step is the one that
 *     takes a secret. Watch-only and remote-signer accounts are added from their own
 *     screens, and offering them here would route a paste to a step that cannot sign.
 *
 * A bare hex private key folds into `nsec`: they are the same import with two spellings,
 * and the caller only uses this to pick a screen.
 */
export function detectImportType(value: string): ImportType {
  const input = value.trim();
  if (input.startsWith('{')) {
    try {
      const parsed = JSON.parse(input);
      if (parsed?.v === 'nip-pqc/v1' || (parsed?.kem && parsed?.dsa)) return 'pqc';
    } catch { /* Invalid JSON must not be mistaken for a mnemonic. */ }
    return null;
  }

  switch (detectImportKind(input)) {
    case 'ncryptsec': return 'ncryptsec';
    case 'nsec':
    case 'hex-private': return 'nsec';
    case 'mnemonic': return 'mnemonic';
    default: return null;
  }
}
