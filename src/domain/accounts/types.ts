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
  walletConfig?: WalletConfig;
  /** Imported post-quantum keys. Absent when the account derives them from its seed. */
  pqKeys?: PqImportedKeys | null;
}

/**
 * Account without secret material — safe to expose.
 *
 * `pqKeys` is omitted for the same reason as `privkey`: it carries ML-KEM and ML-DSA
 * SECRET keys. Every account list the UI receives is a SafeAccount, so leaving it in
 * would hand those secrets to the popup on every render.
 */
export type SafeAccount = Omit<Account, 'privkey' | 'mnemonic' | 'walletConfig' | 'pqKeys'>;

/** Account without private key but with walletConfig — for background wallet handlers */
export type SafeAccountWithWallet = Omit<Account, 'privkey' | 'mnemonic' | 'pqKeys'>;
