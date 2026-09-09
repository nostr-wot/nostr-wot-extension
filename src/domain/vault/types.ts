import type { Account } from '../accounts/types.ts';

/** Account with private key as Uint8Array — used in vault memory only */
export interface MemoryAccount extends Omit<Account, 'privkey' | 'mnemonic' | 'pqKeys'> {
  privkeyBytes: Uint8Array | null;  // zeroed on lock
  mnemonicBytes: Uint8Array | null; // zeroed on lock
  /** Public halves stay strings (they are public); secrets are zeroable bytes. */
  pqPublic: { profile: string; kem: string; dsa: string; importedAt: number } | null;
  pqKemSecretBytes: Uint8Array | null; // zeroed on lock
  pqDsaSecretBytes: Uint8Array | null; // zeroed on lock
}

/** Vault payload with Uint8Array keys — in-memory only */
export interface MemoryVaultPayload {
  accounts: MemoryAccount[];
  activeAccountId: string | null;
}

// ── Vault ──

export interface VaultPayload {
  accounts: Account[];
  activeAccountId: string | null;
}
