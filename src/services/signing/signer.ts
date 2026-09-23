import { rememberSignedZapNote } from '../wallet/payment-records.ts';
import { followCount, followReplacementCount, rememberSignedFollowList } from './followListGuard.ts';
import { captureAccountSession, assertAccountSession } from './accountSession.ts';
import { recordSigningRejection } from './rejections.ts';
import type { UnsignedEvent, SignedEvent } from '@domain/nostr/types.ts';
import * as vault from '../vault/vault.ts';
import * as permissions from '../permissions/permissions.ts';
import { isDomainAllowed } from '../background/domain-handlers.ts';
import { getActiveAccountInfo, getActivePublicKey, isGetPubkeyCooldownActive, startGetPubkeyCooldown } from './identity.ts';
import { queueRequest, resolveBatch, waitForVaultUnlock, runNip46Request } from './approvalQueue.ts';
import { activePqKeys, decryptNip44Content } from './localDecryption.ts';
import { signEvent as cryptoSignEvent } from '@lib/crypto/nip01.ts';
import { hexToBytes, base64ToArray } from '@lib/crypto/utils.ts';
import { nip04Encrypt, nip04Decrypt } from '@lib/crypto/nip04.ts';
import { nip44Encrypt, nip44Decrypt, getConversationKey } from '@lib/crypto/nip44.ts';
import { pqEncrypt, isPqEnvelope } from '@lib/crypto/pq.ts';

/**
 * NIP-07 Signer -- Request Coordinator with In-Popup Approval
 *
 * Handles all NIP-07 signing requests from web pages, coordinating between
 * the vault (key storage), permissions (allow/deny policies), and the
 * popup approval overlay (user authorization).
 *
 * Signing flow:
 *   1. Web page calls window.nostr.signEvent(event)
 *   2. inject.js posts NIP07_REQUEST to content script
 *   3. content.js forwards to background.js with origin
 *   4. background.js routes to signer.js
 *   5. signer checks permissions (even if locked)
 *   6. if permission is 'ask', queues request for popup approval (badge shown)
 *   7. if permission is 'allow' but vault locked, queues as waitingForUnlock
 *   8. user opens popup, sees pending requests, approves/denies
 *   9. vault.getPrivkey() -> sign -> zero key bytes -> return signed event
 *
 * Permissions are account-type-agnostic (allow/deny/ask). After permission
 * is granted, routing is based on account type: NIP-46 forwards to remote
 * signer, local accounts sign with the vault.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/07.md
 * @module services/signing/signer
 */

/**
 * Handle getPublicKey request with permission check
 */
export async function handleGetPublicKey(origin: string): Promise<string | null> {
  const { accountId } = await getActiveAccountInfo();
  const decision = await permissions.check(origin, 'getPublicKey', undefined, accountId ?? undefined);
  if (decision === 'deny') throw new Error('Permission denied');

  if (decision === 'ask') {
    // Connecting a site IS the consent to share the identity pubkey: the
    // "Connect this site" flow adds the origin to allowedDomains AND clears
    // identityDisabled for it, background.ts refuses every NIP-07 method from
    // an origin that is not on that list, and broadcastAccountChanged already
    // pushes the active pubkey to every connected tab unprompted. Asking again
    // here re-requested permission the user had already given — and since a
    // plain "Allow" persisted nothing but the 60s in-memory cooldown, the
    // prompt (and the popup it auto-opens) came back on every service-worker
    // restart, account switch, or page load a minute later.
    //
    // Both opt-outs still win over this: an explicit 'deny' is handled above,
    // and services/background/nip07-handlers.ts rejects the call before it reaches us when
    // identity is disabled for the site.
    if (await isDomainAllowed(origin)) {
      return getActivePublicKey();
    }
    if (isGetPubkeyCooldownActive(origin)) {
      return getActivePublicKey();
    }
    // Snapshot the identity shown in the prompt. The user approves sharing THIS
    // pubkey — if the active account changes while the prompt is pending, the
    // request must be rejected rather than resolved with the new account's key.
    const pubkey = await getActivePublicKey();
    const approved = await queueRequest({
      type: 'getPublicKey',
      origin,
      pubkey: pubkey ?? undefined,
      permKey: permissions.permissionKey('getPublicKey'),
      needsPermission: true,
      accountId,
    });
    if (!approved.allow) throw new Error(approved.reason || 'User denied access');
    const { accountId: nowActiveId } = await getActiveAccountInfo();
    if (nowActiveId !== accountId) throw new Error('Account switched');
    startGetPubkeyCooldown(origin);
    return pubkey;
  }

  // getPublicKey is always local (we know the pubkey for all account types)
  return getActivePublicKey();
}

// -- NIP-07 Request Handlers --

/**
 * Handle signEvent request
 */
export async function handleSignEvent(event: UnsignedEvent, origin: string): Promise<SignedEvent> {
  const revision = vault.getSessionRevision();
  const { accountId, accountType } = await getActiveAccountInfo();
  const requestedPubkey = await getActivePublicKey();
  const requestedAccountId = accountId ?? vault.getActiveAccountId();
  if (event.pubkey && event.pubkey !== requestedPubkey) {
    await recordSigningRejection({ origin, kind: event.kind, requestedPubkey: event.pubkey, activePubkey: requestedPubkey })
      .catch(() => {}); // Storage failure must never turn a rejection into signing.
    throw new Error('Event author does not match active account');
  }

  if (!(await vault.exists()) && accountType !== 'nip46') throw new Error('No signing key available');
  const session = captureAccountSession(accountId ?? vault.getActiveAccountId(), revision);

  // Local permissions apply to ALL account types: an explicit per-origin 'deny'
  // must block even for NIP-46 accounts, BEFORE anything is routed to the
  // remote signer.
  const decision = await permissions.check(origin, 'signEvent', event.kind, accountId ?? undefined);
  if (decision === 'deny') throw new Error('Permission denied');

  // NIP-46 normally delegates approval to the remote signer. Dangerous
  // follow-list replacements require local confirmation for every account type.
  const replacementCount = requestedPubkey ? await followReplacementCount(event, requestedPubkey) : undefined;
  if (replacementCount || (accountType !== 'nip46' && decision === 'ask')) {
    const pubkey = await getActivePublicKey();
    const approved = await queueRequest({
      type: 'signEvent',
      followReplacementCount: replacementCount,
      followReplacementNewCount: replacementCount ? followCount(event) : undefined,
      // Store the FULL content and FULL tags for every kind — the approval
      // prompt must show exactly what will be signed, so a site cannot hide
      // payload in long content or in tags of non-contact-list kinds.
      origin,
      event: { kind: event.kind, content: event.content, tags: event.tags, pubkey:event.pubkey, created_at:event.created_at },
      pubkey: pubkey ?? undefined,
      permKey: permissions.permissionKey('signEvent', event.kind),
      eventKind: event.kind,
      needsPermission: true,
      accountId,
    });
    if (!approved.allow) throw new Error(approved.reason || 'User denied signing');
    if (replacementCount && !approved.confirmFollowReplacement) throw new Error('Follow-list replacement requires explicit confirmation');
    if ((await getActivePublicKey()) !== requestedPubkey || ((await getActiveAccountInfo()).accountId ?? vault.getActiveAccountId()) !== requestedAccountId) throw new Error('Account switched');

    // Save permission and batch-resolve remaining requests if user chose "remember"
    if (approved.remember) {
      const kind = approved.rememberKind !== false ? event.kind : null;
      await permissions.save(origin, 'signEvent', kind ?? null, 'allow', accountId ?? undefined);
      // Batch-resolve remaining requests with the same permKey as the one just approved
      const batchPermKey = permissions.permissionKey('signEvent', event.kind);
      await resolveBatch(origin, batchPermKey, { allow: true, remember: false });
    }
  }

  // Route by account type
  if (accountType === 'nip46') {
    // NIP-46 needs vault unlocked to read nip46Config
    if (vault.isLocked()) {
      await waitForVaultUnlock(origin, 'signEvent', accountId);
    }
    if (vault.isLocked()) throw new Error('Vault is locked');
    if (vault.getActiveAccountId() !== requestedAccountId || vault.getActivePubkey() !== requestedPubkey) throw new Error('Account switched');
    assertAccountSession(session);
    const acct = vault.getAccountById(session.accountId);
    if (!acct || acct.type !== 'nip46') throw new Error('No NIP-46 account active');
    const result = await runNip46Request(acct, 'signEvent', event, origin, session) as SignedEvent;
    assertAccountSession(session);
    await rememberSignedFollowList(result);
    await rememberSignedZapNote(session.accountId, result, () => assertAccountSession(session)).catch(() => {});
    assertAccountSession(session);
    return result;
  }

  // Local signing -- wait for vault unlock if needed
  if (vault.isLocked()) {
    await waitForVaultUnlock(origin, 'signEvent', accountId);
  }

  if (vault.isLocked()) throw new Error('Vault is locked');

  if (vault.getActiveAccountId() !== requestedAccountId || vault.getActivePubkey() !== requestedPubkey) throw new Error('Account switched');
  assertAccountSession(session);
  const privkey = vault.getPrivkey(session.accountId);
  if (!privkey) throw new Error('No private key for active account');

  try {
    const result = await cryptoSignEvent(event, privkey);
    assertAccountSession(session);
    await rememberSignedFollowList(result);
    await rememberSignedZapNote(session.accountId, result, () => assertAccountSession(session)).catch(() => {});
    assertAccountSession(session);
    return result;
  } finally {
    privkey.fill(0);
  }
}

/**
 * Shared handler for NIP-04/NIP-44 encrypt/decrypt requests.
 * All four operations follow the same flow: permission check → NIP-46 routing → local crypto.
 */
async function handleCryptoRequest(
  method: 'nip04Encrypt' | 'nip04Decrypt' | 'nip44Encrypt' | 'nip44Decrypt',
  theirPubkey: string,
  payload: string,
  origin: string,
  nip46Data: Record<string, string>,
  cryptoFn: (payload: string, privkey: Uint8Array, theirPubkeyBytes: Uint8Array, accountId?: string) => Promise<string>,
  denyMessage: string,
  /**
   * Message to reject a NIP-46 account with instead of delegating to the bunker.
   *
   * Post-quantum passes this, and must. A bunker knows nothing about our envelope and
   * answers `nip44Encrypt` with ordinary NIP-44 ciphertext, so without this the caller
   * would receive classic ciphertext in response to a post-quantum request with no way
   * to tell the difference. That silent downgrade is the exact failure the opt-in and
   * the `schemes` marker exist to prevent, and it cannot be caught in `cryptoFn`, which
   * a remote-signer account never reaches. See `nips/pqc/04-nip07-encryption-capability.md`.
   *
   * Checked after the permission gate, so an origin cannot probe the active account's
   * type without first being allowed to make the call at all.
   */
  remoteSignerUnsupported?: string,
): Promise<string> {
  const revision = vault.getSessionRevision();
  const { accountId, accountType } = await getActiveAccountInfo();

  if (!(await vault.exists()) && accountType !== 'nip46') throw new Error('No signing key available');
  const session = captureAccountSession(accountId ?? vault.getActiveAccountId(), revision);

  // Local permissions apply to ALL account types: an explicit per-origin 'deny'
  // blocks even NIP-46 accounts before anything reaches the remote signer.
  const decision = await permissions.check(origin, method, undefined, accountId ?? undefined);
  if (decision === 'deny') throw new Error('Permission denied');

  // NIP-46 accounts skip the local 'ask' prompt — the bunker runs its own approval.
  if (accountType !== 'nip46' && decision === 'ask') {
    const pubkey = await getActivePublicKey();
    const approved = await queueRequest({
      type: method,
      origin,
      theirPubkey,
      pubkey: pubkey ?? undefined,
      permKey: permissions.permissionKey(method),
      needsPermission: true,
      accountId,
    });
    if (!approved.allow) throw new Error(denyMessage);
  }

  if (accountType === 'nip46') {
    if (remoteSignerUnsupported) throw new Error(remoteSignerUnsupported);
    if (vault.isLocked()) {
      await waitForVaultUnlock(origin, method, accountId);
    }
    if (vault.isLocked()) throw new Error('Vault is locked');
    assertAccountSession(session);
    const acct = vault.getAccountById(session.accountId);
    if (!acct || acct.type !== 'nip46') throw new Error('No NIP-46 account active');
    const result = await runNip46Request(acct, method, nip46Data, origin, session) as string;
    assertAccountSession(session);
    return result;
  }

  if (vault.isLocked()) {
    await waitForVaultUnlock(origin, method, accountId);
  }
  if (vault.isLocked()) throw new Error('Vault is locked');

  assertAccountSession(session);
  const privkey = vault.getPrivkey(session.accountId);
  if (!privkey) throw new Error('No private key for active account');
  try {
    const result = await cryptoFn(payload, privkey, hexToBytes(theirPubkey), session.accountId);
    assertAccountSession(session);
    return result;
  } finally {
    privkey.fill(0);
  }
}

export async function handleNip04Encrypt(theirPubkey: string, plaintext: string, origin: string): Promise<string> {
  return handleCryptoRequest('nip04Encrypt', theirPubkey, plaintext, origin,
    { pubkey: theirPubkey, plaintext }, nip04Encrypt, 'User denied encryption');
}

export async function handleNip04Decrypt(theirPubkey: string, ciphertext: string, origin: string): Promise<string> {
  return handleCryptoRequest('nip04Decrypt', theirPubkey, ciphertext, origin,
    { pubkey: theirPubkey, ciphertext }, nip04Decrypt, 'User denied decryption');
}

/** Post-quantum options a caller may pass to nip44Encrypt. */
export interface PqEncryptOptions {
  scheme: 'pq';
  /** Recipient's ML-KEM-1024 key, base64, from their kind:10203 attestation. */
  recipientKemKey: string;
}

/**
 * Encrypt with NIP-44, or post-quantum when the caller explicitly asks for it.
 *
 * The post-quantum path is opt-in rather than inferred, deliberately. Inferring would
 * mean this signer fetching the recipient's attestation from relays mid-call — network
 * I/O inside a signing operation — and then deciding what to do when the lookup fails.
 * The only options there are to break every existing caller or to fall back to classic
 * silently, and a silent downgrade is exactly the failure this whole scheme exists to
 * prevent. The calling application owns that decision, so it passes the key it already
 * has.
 */
export async function handleNip44Encrypt(
  theirPubkey: string,
  plaintext: string,
  origin: string,
  opts?: PqEncryptOptions,
): Promise<string> {
  if (opts?.scheme !== 'pq') {
    return handleCryptoRequest('nip44Encrypt', theirPubkey, plaintext, origin,
      { pubkey: theirPubkey, plaintext }, nip44Encrypt, 'User denied encryption');
  }

  return handleCryptoRequest(
    'nip44Encrypt', theirPubkey, plaintext, origin,
    { pubkey: theirPubkey, plaintext },
    async (payload, privkey, theirPubkeyBytes, accountId) => {
      const { keys, pubkey } = await activePqKeys(accountId);
      let conv: Uint8Array | null = null;
      try {
        const kem = base64ToArray(opts.recipientKemKey);
        conv = getConversationKey(privkey, theirPubkeyBytes);
        return pqEncrypt(payload, kem, conv, pubkey, theirPubkey);
      } finally {
        conv?.fill(0);
        keys.kem.secretKey.fill(0);
        keys.dsa.secretKey.fill(0);
      }
    },
    'User denied encryption',
    'Remote signers do not support post-quantum encryption',
  );
}

/**
 * Decrypt with NIP-44, or post-quantum when the payload says so.
 *
 * This direction needs no flag and takes none. Our envelope is self-describing — a
 * version byte and an algorithm byte — so the payload itself determines the route.
 * A caller cannot get it wrong, and existing clients keep working untouched.
 */
export async function handleNip44Decrypt(theirPubkey: string, ciphertext: string, origin: string): Promise<string> {
  if (!isPqEnvelope(ciphertext)) {
    return handleCryptoRequest('nip44Decrypt', theirPubkey, ciphertext, origin,
      { pubkey: theirPubkey, ciphertext }, nip44Decrypt, 'User denied decryption');
  }

  return handleCryptoRequest(
    'nip44Decrypt', theirPubkey, ciphertext, origin,
    { pubkey: theirPubkey, ciphertext },
    decryptNip44Content,
    'User denied decryption',
    'Remote signers cannot read post-quantum messages',
  );
}
