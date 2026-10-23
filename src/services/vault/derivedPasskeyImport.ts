import { parseNosskeyAccount, nosskeyPrfInput, recoverNosskeyAccount, hexToBytes } from '@nostr-wot/identity/vault';
import { t } from '@services/i18n/i18n.ts';
import type { DerivedParameterSet } from '@constants/passkey.ts';
import { assertPasskeyPrf, authorizePasskeyDomain, PRF_UNAVAILABLE_MESSAGE, type PrfAssertion } from '@services/vault/passkeyClient.ts';
import { classifyPasskeyHandle, decideDerivedImport, isKnownDerivedHost, normalizeExternalPasskeyHost } from '@domain/vault/passkeyKeyModes.ts';
import { deriveDerivedPasskeyKey, derivedPasskeyPubkey, derivedPrfInput, isDerivedParameterSet } from '@lib/crypto/passkeyDerived.ts';
import { npubEncode } from '@lib/crypto/bech32.ts';
import { bytesToHex } from '@lib/crypto/utils.ts';

/** A derived key awaiting the user's confirmation. `secret` is zeroed by clearDerivedPasskey. */
export interface DerivedPasskeyCandidate {
  rpId: string;
  parameterSet?: DerivedParameterSet;
  confidence: 'derived' | 'ambiguous' | 'backup';
  pubkey: string;
  npub: string;
  secret: Uint8Array;
}

export class DerivedPasskeyRefusedError extends Error {
  constructor(readonly reason: 'stored' | 'unsupported' | 'parameter-set', message: string) {
    super(message);
    this.name = 'DerivedPasskeyRefusedError';
  }
}

function refusalMessage(reason: DerivedPasskeyRefusedError['reason'], parameterSet?: number): string {
  if (reason === 'stored') return t('passkeyImport.refusedStored');
  if (reason === 'unsupported') return t('passkeyImport.refusedUnsupported');
  return t('passkeyImport.refusedParameterSet', { set: `0x${(parameterSet ?? 0).toString(16).padStart(2, '0')}` });
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/**
 * Ask the browser for a passkey created by another app under `host`, and compute the
 * derived-mode key it produces. Must be called from a user gesture: the first await
 * is the host permission request for exactly `https://<host>/*`.
 *
 * Refuses, before any derivation, every handle the specification says is not derived
 * with this parameter set. When the discoverable assertion returns no PRF output the
 * request is repeated once against the selected credential, since some platforms skip
 * extensions when no credential is named; without output after that it fails with the
 * existing PRF-unavailable error. Nothing is imported here.
 */
export async function readDerivedPasskey(hostInput: string, parameterSet: DerivedParameterSet): Promise<DerivedPasskeyCandidate> {
  const rpId = normalizeExternalPasskeyHost(hostInput);
  if (!rpId) throw new Error(t('passkeyImport.invalidHost'));
  if (!isDerivedParameterSet(parameterSet)) throw new Error(t('passkeyImport.refusedUnsupported'));
  await authorizePasskeyDomain(rpId);
  const input = derivedPrfInput(parameterSet);
  const assertions: PrfAssertion[] = [];
  try {
    const first = await assertPasskeyPrf(rpId, input);
    assertions.push(first);
    const decision = decideDerivedImport(classifyPasskeyHandle(first.userHandle), parameterSet, isKnownDerivedHost(rpId, parameterSet));
    if (decision.action === 'refuse') throw new DerivedPasskeyRefusedError(decision.reason, refusalMessage(decision.reason, decision.parameterSet));
    let prf = first.prf;
    if (!prf) {
      const retry = await assertPasskeyPrf(rpId, input, first.credentialId);
      assertions.push(retry);
      if (!sameBytes(retry.credentialId, first.credentialId)) throw new Error(t('passkey.cancelled'));
      prf = retry.prf;
    }
    if (!prf) throw new Error(PRF_UNAVAILABLE_MESSAGE);
    const secret = deriveDerivedPasskeyKey(prf, parameterSet);
    try {
      const pubkey = derivedPasskeyPubkey(secret);
      return { rpId, parameterSet, confidence: decision.confidence, pubkey, npub: npubEncode(pubkey), secret };
    } catch (error) {
      secret.fill(0);
      throw error;
    }
  } finally {
    for (const assertion of assertions) assertion.prf?.fill(0);
  }
}

/** Hex form for the existing import RPC; the bytes stay owned by the candidate. */
export function derivedPasskeySecretHex(candidate: DerivedPasskeyCandidate): string {
  if (candidate.secret.length !== 32 || candidate.secret.every(byte => byte === 0)) throw new Error(t('wizard.importFailed'));
  return bytesToHex(candidate.secret);
}

export function clearDerivedPasskey(candidate: DerivedPasskeyCandidate | null | undefined): void {
  candidate?.secret.fill(0);
}

/** Restore only the account explicitly named by a Nosskey backup; never guess its mode. */
export async function readNosskeyPasskey(hostInput: string, backup: string): Promise<DerivedPasskeyCandidate> {
  const rpId = normalizeExternalPasskeyHost(hostInput);
  if (!rpId) throw new Error(t('passkeyImport.invalidHost'));
  const account = parseNosskeyAccount(backup);
  await authorizePasskeyDomain(rpId);
  const credentialId = hexToBytes(account.credentialId);
  const assertion = await assertPasskeyPrf(rpId, nosskeyPrfInput(account), credentialId);
  try {
    if (!sameBytes(assertion.credentialId, credentialId)) throw new Error(t('passkey.cancelled'));
    if (!assertion.prf) throw new Error(PRF_UNAVAILABLE_MESSAGE);
    const secret = recoverNosskeyAccount(account, assertion.prf);
    return {rpId,confidence:'backup',pubkey:account.pubkey,npub:npubEncode(account.pubkey),secret};
  } finally { assertion.prf?.fill(0); }
}
