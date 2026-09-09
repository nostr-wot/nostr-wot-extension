import type { MemoryVaultPayload } from '@domain/vault/types.ts';
import { arrayToBase64 } from '@lib/crypto/utils.ts';

/** Operations access the live private session through injected capabilities. */
export function createImportedKeyAccess(readPayload: () => MemoryVaultPayload | null, save: () => Promise<void>) {

  /**
   * Store externally generated post-quantum keys on an account, and persist.
   *
   * Callers must have validated the pair first (`parsePqKeyfile`) — this only stores.
   * @param accountId
   * @param keys - validated ML-KEM / ML-DSA pairs
   * @param profile - derivation profile the key file declared
   */
  async function setImportedPqKeys(
    accountId: string,
    keys: { kem: { publicKey: Uint8Array; secretKey: Uint8Array }; dsa: { publicKey: Uint8Array; secretKey: Uint8Array } },
    profile: string,
  ): Promise<void> {
    const _decrypted = readPayload();
    if (!_decrypted) throw new Error('Vault is locked');
    const acct = _decrypted.accounts.find(a => a.id === accountId);
    if (!acct) throw new Error('Account not found');

    // Replacing an existing import: zero the outgoing secrets first.
    if (acct.pqKemSecretBytes) acct.pqKemSecretBytes.fill(0);
    if (acct.pqDsaSecretBytes) acct.pqDsaSecretBytes.fill(0);

    acct.pqPublic = {
      profile,
      kem: arrayToBase64(keys.kem.publicKey),
      dsa: arrayToBase64(keys.dsa.publicKey),
      importedAt: Date.now(),
    };
    acct.pqKemSecretBytes = new Uint8Array(keys.kem.secretKey);
    acct.pqDsaSecretBytes = new Uint8Array(keys.dsa.secretKey);
    await save();
  }

  /**
   * Remove an account's imported post-quantum keys, zeroing the secrets.
   * @returns true if there was something to remove
   */
  async function clearImportedPqKeys(accountId: string): Promise<boolean> {
    const _decrypted = readPayload();
    if (!_decrypted) throw new Error('Vault is locked');
    const acct = _decrypted.accounts.find(a => a.id === accountId);
    if (!acct || !acct.pqPublic) return false;
    if (acct.pqKemSecretBytes) acct.pqKemSecretBytes.fill(0);
    if (acct.pqDsaSecretBytes) acct.pqDsaSecretBytes.fill(0);
    acct.pqPublic = null;
    acct.pqKemSecretBytes = null;
    acct.pqDsaSecretBytes = null;
    await save();
    return true;
  }

  /**
   * Run `fn` with an account's imported post-quantum secret keys, zeroing the copies
   * afterwards on every path. Mirrors withPrivkey.
   *
   * @returns null when the account has no imported keys, so callers can fall back to
   *          deriving from the seed
   */
  async function withImportedPqKeys<T>(
    accountId: string | undefined,
    fn: (keys: { kemSecret: Uint8Array; dsaSecret: Uint8Array; kemPublic: string; dsaPublic: string }) => Promise<T>,
  ): Promise<T | null> {
    const _decrypted = readPayload();
    if (!_decrypted) throw new Error('Vault is locked');
    const id = accountId || _decrypted.activeAccountId;
    const acct = _decrypted.accounts.find(a => a.id === id);
    if (!acct?.pqPublic || !acct.pqKemSecretBytes || !acct.pqDsaSecretBytes) return null;

    const kemSecret = new Uint8Array(acct.pqKemSecretBytes);
    const dsaSecret = new Uint8Array(acct.pqDsaSecretBytes);
    try {
      return await fn({ kemSecret, dsaSecret, kemPublic: acct.pqPublic.kem, dsaPublic: acct.pqPublic.dsa });
    } finally {
      kemSecret.fill(0);
      dsaSecret.fill(0);
    }
  }

  /** Does this account carry imported post-quantum keys? Reveals nothing secret. */
  function hasImportedPqKeys(accountId?: string): boolean {
    const _decrypted = readPayload();
    if (!_decrypted) return false;
    const id = accountId || _decrypted.activeAccountId;
    return !!_decrypted.accounts.find(a => a.id === id)?.pqPublic;
  }
  return { setImportedPqKeys, clearImportedPqKeys, withImportedPqKeys, hasImportedPqKeys };
}
