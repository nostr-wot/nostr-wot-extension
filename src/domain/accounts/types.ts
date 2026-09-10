import type { WalletConfig } from '../wallet/types.ts';

// ── Accounts ──

export type AccountType = 'generated' | 'nsec' | 'npub' | 'nip46' | 'external';

export interface Nip46Config {
  bunkerUrl: string;
  relay: string | null;
  secret: string | null;
  localPrivkey?: string;
  localPubkey?: string;
}

/**
 * Post-quantum keys imported from outside, for an account that cannot derive its own.
 *
 * Only ever set on accounts with no 24-word mnemonic. Unlike derived keys these are NOT
 * recoverable from the seed phrase — they are independent secrets the user must back up
 * separately, which is why the UI says so persistently rather than once.
 *
 * All four values are base64. The two `secret` halves are key material: this type must
 * stay out of `SafeAccount`.
 */
export interface PqImportedKeys {
  /** Derivation profile the key file declared, e.g. "nip-pqc/v1". */
  profile: string;
  kem: { public: string; secret: string };
  dsa: { public: string; secret: string };
  importedAt: number;
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  pubkey: string;
  privkey: string | null;
  mnemonic: string | null;
  nip46Config: Nip46Config | null;
  readOnly: boolean;
  createdAt: number;
  derivationIndex?: number;
  /** Canonical BIP-32 path required to restore this identity from its seed. */
  derivationPath?: string;
  walletConfig?: WalletConfig;
  /** Imported post-quantum keys. Absent when the account derives them from its seed. */
  pqKeys?: PqImportedKeys | null;
}

/** Explicit public metadata allowlist. New Account fields are private by default. */
export type SafeAccount = Pick<Account,
  'id' | 'name' | 'type' | 'pubkey' | 'readOnly' | 'createdAt' | 'derivationIndex' | 'derivationPath'>;

/** Background-only wallet capability. Never return this through a UI/page RPC. */
export type SafeAccountWithWallet = SafeAccount & Pick<Account, 'walletConfig'>;

/** Background-only remote signer capability; includes connection secrets. */
export type BackgroundRemoteSignerAccount = SafeAccount & { nip46Config: Nip46Config };
