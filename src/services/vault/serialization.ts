import type { VaultPayload, MemoryAccount, MemoryVaultPayload } from '@domain/vault/types.ts';
import type { Account } from '@domain/accounts/types.ts';
import { hexToBytes, bytesToHex, arrayToBase64, base64ToArray } from '@lib/crypto/utils.ts';

/** Convert Account (JSON storage format) to MemoryAccount (in-memory format) */
export function toMemoryAccount(acct: Account): MemoryAccount {
  const { privkey, mnemonic, pqKeys, ...rest } = acct;
  return {
    ...rest,
    privkeyBytes: privkey ? hexToBytes(privkey) : null,
    mnemonicBytes: mnemonic ? new TextEncoder().encode(mnemonic) : null,
    // Imported post-quantum secrets get the same treatment as the nsec: held as bytes
    // so lock() can zero them, rather than as strings that linger until GC.
    pqPublic: pqKeys
      ? { profile: pqKeys.profile, kem: pqKeys.kem.public, dsa: pqKeys.dsa.public, importedAt: pqKeys.importedAt }
      : null,
    pqKemSecretBytes: pqKeys ? base64ToArray(pqKeys.kem.secret) : null,
    pqDsaSecretBytes: pqKeys ? base64ToArray(pqKeys.dsa.secret) : null,
  };
}

/** Convert MemoryAccount back to Account (JSON storage format) */
export function toStorageAccount(acct: MemoryAccount): Account {
  const { privkeyBytes, mnemonicBytes, pqPublic, pqKemSecretBytes, pqDsaSecretBytes, ...rest } = acct;
  return {
    ...rest,
    privkey: privkeyBytes ? bytesToHex(privkeyBytes) : null,
    mnemonic: mnemonicBytes ? new TextDecoder().decode(mnemonicBytes) : null,
    pqKeys: pqPublic && pqKemSecretBytes && pqDsaSecretBytes
      ? {
          profile: pqPublic.profile,
          kem: { public: pqPublic.kem, secret: arrayToBase64(pqKemSecretBytes) },
          dsa: { public: pqPublic.dsa, secret: arrayToBase64(pqDsaSecretBytes) },
          importedAt: pqPublic.importedAt,
        }
      : null,
  };
}

/** Convert MemoryVaultPayload back to VaultPayload for serialization */
export function toStoragePayload(mem: MemoryVaultPayload): VaultPayload {
  return {
    accounts: mem.accounts.map(toStorageAccount),
    activeAccountId: mem.activeAccountId,
  };
}