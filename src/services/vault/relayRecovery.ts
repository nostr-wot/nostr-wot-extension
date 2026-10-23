import { getRecoveryStatus, recordRecoveryPublication } from './recoveryStatus.ts';
import * as vault from './vault.ts';
import { DEFAULT_RELAYS } from '@constants/relays.ts';
import { PASSKEY_RECOVERY_KIND, PASSKEY_RECOVERY_PRF, PASSKEY_VAULT_VERSION, PASSKEY_BACKUP_FORMAT, PASSKEY_RECOVERY_RELAY_TIMEOUT_MS, PASSKEY_RECOVERY_CANDIDATE_LIMIT } from '@constants/passkey.ts';
import { type RelayRecoveryHealth, type PasskeyProof, type PasskeyMetadata, type RecoveryScope, parsePasskeyBackup } from '@domain/vault/passkey.ts';
import { encryptRecovery, decryptRecovery, recoveryTags, recoveryCoordinate, validateRecoveryEvent, recoveryContextFromEvent, type RecoveryContext } from './recoveryCodec.ts';
import { queryRelay, publishRelay } from '@services/relays/transport.ts';
import { signEvent } from '@lib/crypto/nip01.ts';
import { getPublicKey } from '@lib/crypto/secp256k1.ts';
import { hexToBytes, bytesToHex, arrayToBase64 } from '@lib/crypto/utils.ts';
import { createFromMnemonicAtPath, createFromMnemonicAtIndex, importNsec } from '@domain/accounts/creation.ts';
import { wrapVaultKey, importVaultKey, unwrapVaultKey } from './passkeyEncryption.ts';
import { encrypt } from './encryption.ts';
import type { SignedEvent } from '@domain/nostr/types.ts';
import type { VaultPayload } from '@domain/vault/types.ts';

/** Pure ciphertext leaves this background-only module. No private keys go to the popup. */
export async function prepareRelayRecovery(proof: PasskeyProof): Promise<SignedEvent> {
  await vault.requireUnlocked(); const revision = vault.getSessionRevision();
  const record = parsePasskeyBackup(await vault.exportPasskeyBackup());
  const metadata = record.passkeys.find(p => p.credentialId === proof.credentialId);
  if (!metadata?.recoveryPubkey || !metadata.recoveryScope || metadata.prfSalt !== PASSKEY_RECOVERY_PRF) throw new Error('Register a new passkey to enable relay recovery');
  const verified = await unwrapVaultKey(metadata, proof); verified.fill(0);
  const payload = vault.getDecryptedPayload();
  const account = payload.accounts.find(a => a.id === payload.activeAccountId);
  if (!account?.privkey || account.readOnly || !['generated', 'nsec'].includes(account.type)) throw new Error('The selected account has no local secret to recover');
  if (account.pubkey !== metadata.recoveryPubkey) throw new Error('This passkey belongs to another account. Select a passkey registered for the current account.');
  const ctx: RecoveryContext = { credentialId: metadata.credentialId, rpId: metadata.rpId ?? record.rpId, pubkey: account.pubkey, scope: account.mnemonic ? 'seed' : 'private-key' };
  const secret = hexToBytes(account.privkey); let bytes: Uint8Array | undefined;
  try {
    if (ctx.scope === 'private-key') bytes = secret.slice();
    else {
      if (!account.mnemonic) throw new Error('This account has no seed phrase');
      // Older vaults stored only the NIP-06 index (or neither field for the main account).
      // Verify that the recoverable seed/path actually reproduces this identity before signing.
      const recovered = account.derivationPath !== undefined
        ? await createFromMnemonicAtPath(account.mnemonic, account.derivationPath, account.name)
        : await createFromMnemonicAtIndex(account.mnemonic, account.derivationIndex ?? 0, account.name);
      if (recovered.pubkey !== account.pubkey) throw new Error('Seed derivation does not match the account');
      bytes = new TextEncoder().encode(JSON.stringify({ version: 1, mnemonic: account.mnemonic, accounts: [{ name: account.name, pubkey: account.pubkey, path: recovered.derivationPath }] }));
    }
    const content = await encryptRecovery(bytes, proof.prf, ctx);
    if (vault.isLocked() || revision !== vault.getSessionRevision()) throw new Error('Vault session changed');
    const event = await signEvent({ kind: PASSKEY_RECOVERY_KIND, pubkey: ctx.pubkey, created_at: Math.floor(Date.now() / 1000), content, tags: recoveryTags(ctx) }, secret);
    if (vault.isLocked() || revision !== vault.getSessionRevision()) throw new Error('Vault session changed');
    return event;
  } finally { secret.fill(0); bytes?.fill(0); }
}

export async function publishRelayRecovery(event: SignedEvent, ctx: RecoveryContext, publish = publishRelay) {
  await vault.requireUnlocked(); const revision = vault.getSessionRevision();
  await validateRecoveryEvent(event, ctx);
  const enrolled = (await vault.listPasskeys()).find(p => p.credentialId === ctx.credentialId);
  const account = vault.getDecryptedPayload().accounts.find(a => a.id === vault.getDecryptedPayload().activeAccountId);
  if (!account?.privkey || account.readOnly || ctx.pubkey !== account.pubkey || ctx.scope !== (account.mnemonic ? 'seed' : 'private-key') || !enrolled || enrolled.rpId !== ctx.rpId || enrolled.recoveryPubkey !== ctx.pubkey) throw new Error('Recovery does not match an enrolled passkey');
  const assertSession = () => { if (vault.isLocked() || revision !== vault.getSessionRevision() || vault.getDecryptedPayload().activeAccountId !== account.id) throw new Error('Vault session changed'); };
  const { relays } = await getRecoveryStatus(ctx.credentialId);
  const results = await Promise.all(relays.map(async relay => {
    try { return { relay, ...await publish(relay, event, { timeoutMs: PASSKEY_RECOVERY_RELAY_TIMEOUT_MS, assertSession }) }; }
    catch { return { relay, accepted: false, message: 'Could not publish recovery' }; }
  }));
  assertSession();
  await recordRecoveryPublication(ctx.credentialId, results, event.id);
  if (!results.some(r => r.accepted)) throw new Error('Recovery could not be saved on any relay. Retry or download a recovery file.');
  return results;
}
/** Public availability checks verify signatures and context, not decryptability. */
export async function checkRelayRecovery(credentialId: string, query = queryRelay): Promise<RelayRecoveryHealth[]> {
  await vault.requireUnlocked();
  const metadata = (await vault.listPasskeys()).find(item => item.credentialId === credentialId);
  if (!metadata?.recoveryPubkey || !metadata.rpId) throw new Error('No recovery locator for this passkey');
  const ctx = { credentialId, pubkey: metadata.recoveryPubkey, rpId: metadata.rpId };
  const { relays } = await getRecoveryStatus(credentialId);
  return Promise.all(relays.map(async relay => {
    const checkedAt = Date.now();
    try {
      const result = await query(relay, { kinds: [PASSKEY_RECOVERY_KIND], authors: [ctx.pubkey], '#d': (['vault', 'seed', 'private-key'] as const).map(scope => recoveryCoordinate({ ...ctx, scope })), limit: PASSKEY_RECOVERY_CANDIDATE_LIMIT }, { limit: PASSKEY_RECOVERY_CANDIDATE_LIMIT, timeoutMs: PASSKEY_RECOVERY_RELAY_TIMEOUT_MS });
      const valid: SignedEvent[] = [];
      for (const event of result.events) {
        try { await validateRecoveryEvent(event, recoveryContextFromEvent(event, ctx)); valid.push(event); }
        catch { /* Untrusted relay content is not evidence of a valid recovery copy. */ }
      }
      valid.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
      if (valid.length) return { relay, status: 'found' as const, checkedAt, createdAt: valid[0].created_at, eventId: valid[0].id };
      return { relay, status: result.status !== 'eose' ? 'unavailable' as const : result.events.length ? 'invalid' as const : 'missing' as const, checkedAt };
    } catch { return { relay, status: 'unavailable' as const, checkedAt }; }
  }));
}

export async function fetchRelayRecovery(ctx: Omit<RecoveryContext, 'scope'> & { scope?: RecoveryScope }, query = queryRelay): Promise<SignedEvent> {
  const relays = await getRecoveryStatus(ctx.credentialId).then(state => state.relays).catch(() => DEFAULT_RELAYS);
  const results = await Promise.all(relays.map(relay => query(relay, { kinds: [PASSKEY_RECOVERY_KIND], authors: [ctx.pubkey], '#d': (ctx.scope ? [ctx.scope] : ['vault', 'seed', 'private-key'] as const).map(scope => recoveryCoordinate({ ...ctx, scope })), limit: PASSKEY_RECOVERY_CANDIDATE_LIMIT }, { limit: PASSKEY_RECOVERY_CANDIDATE_LIMIT, timeoutMs: PASSKEY_RECOVERY_RELAY_TIMEOUT_MS })));
  const events = results.flatMap(r => r.events).sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
  for (const event of events) {
    try {
      const actual = recoveryContextFromEvent(event, ctx);
      if (ctx.scope && actual.scope !== ctx.scope) continue;
      await validateRecoveryEvent(event, actual); return event;
    }
    catch { /* Invalid public events cannot override a valid signed snapshot. */ }
  }
  throw new Error('No recovery found on the recovery relays. Check the passkey domain and scope, or use your recovery file.');
}

export async function prepareRelayRecoveryBackup(event: SignedEvent, proof: PasskeyProof, ctx: RecoveryContext): Promise<string> {
  if (proof.credentialId !== ctx.credentialId) throw new Error('Recovery credential mismatch');
  await validateRecoveryEvent(event, ctx);
  const bytes = await decryptRecovery(event.content, proof.prf, ctx);
  try {
    if (ctx.scope === 'vault') {
      const backup = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const record = parsePasskeyBackup(backup);
      const wrapper = record.passkeys.find(p => p.credentialId === ctx.credentialId);
      if (!wrapper || wrapper.rpId !== ctx.rpId || wrapper.prfSalt !== PASSKEY_RECOVERY_PRF || wrapper.recoveryPubkey !== ctx.pubkey) throw new Error('Recovery vault context mismatch');
      return backup;
    }
    const payload: VaultPayload = { accounts: [], activeAccountId: null, cacheKey: arrayToBase64(crypto.getRandomValues(new Uint8Array(32))) };
    if (ctx.scope === 'private-key') {
      if (bytesToHex(getPublicKey(bytes)) !== ctx.pubkey) throw new Error('Recovered private key does not match the account');
      payload.accounts = [await importNsec(bytesToHex(bytes))];
    } else {
      const seed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (seed.version !== 1 || typeof seed.mnemonic !== 'string' || seed.mnemonic.length > 512 || !Array.isArray(seed.accounts) || !seed.accounts.length || seed.accounts.length > 100) throw new Error('Invalid seed recovery');
      for (const entry of seed.accounts) {
        if (typeof entry.path !== 'string' || typeof entry.name !== 'string' || entry.name.length > 100) throw new Error('Invalid seed derivation');
        const account = await createFromMnemonicAtPath(seed.mnemonic, entry.path, entry.name);
        if (account.pubkey !== entry.pubkey || payload.accounts.some(a => a.pubkey === account.pubkey)) throw new Error('Seed account mismatch');
        payload.accounts.push(account);
      }
      if (!payload.accounts.some(a => a.pubkey === ctx.pubkey)) throw new Error('Seed does not match recovery author');
    }
    payload.activeAccountId = payload.accounts.find(a => a.pubkey === ctx.pubkey)!.id;
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    try {
      const metadata: PasskeyMetadata = { credentialId: ctx.credentialId, rpId: ctx.rpId, prfSalt: PASSKEY_RECOVERY_PRF, recoveryPubkey: ctx.pubkey, recoveryScope: ctx.scope };
      const wrapper = await wrapVaultKey(rawKey, { ...metadata, prf: proof.prf });
      const encrypted = await encrypt(await importVaultKey(rawKey), JSON.stringify(payload));
      const backup = JSON.stringify({ format: PASSKEY_BACKUP_FORMAT, vault: { version: PASSKEY_VAULT_VERSION, protection: 'passkey', rpId: ctx.rpId, passkeys: [wrapper], iv: arrayToBase64(encrypted.iv), ciphertext: arrayToBase64(encrypted.ciphertext) } });
      return backup;
    } finally { rawKey.fill(0); }
  } finally { bytes.fill(0); }
}

export async function restoreRelayRecovery(event: SignedEvent, proof: PasskeyProof, ctx: RecoveryContext): Promise<void> {
  await vault.restorePasskeyBackup(await prepareRelayRecoveryBackup(event, proof, ctx), proof);
}
