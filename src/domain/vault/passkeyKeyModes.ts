import { DERIVED_PASSKEY_APPS, NPK_HANDLE_MAGIC, NPK_HANDLE_VERSION, PASSKEY_RP_ID, LEGACY_PASSKEY_RP_ID, type DerivedParameterSet } from '@constants/passkey.ts';
import { validRpId } from '@domain/vault/passkey.ts';

/**
 * Passkey handle classification from nips/passkey/01-passkey-key-modes.md,
 * "Telling the modes apart: the handle". Pure: no WebAuthn, no key material.
 */
export type PasskeyHandleClass =
  | { mode: 'derived'; parameterSet: number }
  /** `legacy` marks the pre-specification formats; key-in-handle carries no author. */
  | { mode: 'stored'; author?: Uint8Array; legacy?: 'raw-pubkey' | 'key-in-handle' }
  | { mode: 'unsupported' }
  | { mode: 'unknown' };

const DERIVED_HANDLE_BYTES = 22;
const STORED_HANDLE_BYTES = 37;

function npkPrefix(handle: Uint8Array): boolean {
  return handle.length >= 3 && NPK_HANDLE_MAGIC.every((byte, index) => handle[index] === byte);
}

/** Classify a returned userHandle in the order the specification requires. */
export function classifyPasskeyHandle(handle: Uint8Array | null | undefined): PasskeyHandleClass {
  if (!handle || handle.length === 0) return { mode: 'unknown' };
  const tagged = npkPrefix(handle) && handle[3] === NPK_HANDLE_VERSION;
  if (tagged && handle[4] === 0x01 && handle.length === DERIVED_HANDLE_BYTES) return { mode: 'derived', parameterSet: handle[5] };
  if (tagged && handle[4] === 0x02 && handle.length === STORED_HANDLE_BYTES) return { mode: 'stored', author: handle.slice(5) };
  // Before the NPK rule: a raw public key may happen to start with "NPK".
  if (handle.length === 32) return { mode: 'stored', legacy: 'raw-pubkey', author: handle.slice() };
  if (handle.length === 33 && handle[0] === 0x03) return { mode: 'stored', legacy: 'key-in-handle' };
  if (npkPrefix(handle)) return { mode: 'unsupported' };
  return { mode: 'unknown' };
}

/** What an import of a derived key from another app may do with a classified handle. */
export type DerivedImportDecision =
  /** Tagged with the expected set, or untagged on a host known to use that set. */
  | { action: 'derive'; confidence: 'derived' }
  /** Untagged on a host nobody configured: show the npub, the user decides. */
  | { action: 'derive'; confidence: 'ambiguous' }
  | { action: 'refuse'; reason: 'stored' | 'unsupported' | 'parameter-set'; parameterSet?: number };

/**
 * Decide whether a derived key may be computed. Never derives from a stored or
 * unsupported handle, or from a tagged handle naming another parameter set.
 *
 * A 32-byte handle is "probably legacy stored" until a record lookup proves
 * otherwise. This import performs no relay or largeBlob lookup, so it refuses
 * such a handle rather than risk turning a stored-mode passkey into an empty account.
 */
export function decideDerivedImport(handle: PasskeyHandleClass, expected: DerivedParameterSet, knownHost: boolean): DerivedImportDecision {
  if (handle.mode === 'stored') return { action: 'refuse', reason: 'stored' };
  if (handle.mode === 'unsupported') return { action: 'refuse', reason: 'unsupported' };
  if (handle.mode === 'derived') {
    return handle.parameterSet === expected
      ? { action: 'derive', confidence: 'derived' }
      : { action: 'refuse', reason: 'parameter-set', parameterSet: handle.parameterSet };
  }
  return { action: 'derive', confidence: knownHost ? 'derived' : 'ambiguous' };
}

/** True when the registry lists this host as deploying this parameter set. */
export function isKnownDerivedHost(rpId: string, parameterSet: DerivedParameterSet): boolean {
  return DERIVED_PASSKEY_APPS.some(app => app.rpId === rpId && app.parameterSet === parameterSet);
}

/**
 * Accept a bare host or an `https://host[/]` origin, nothing else: no other scheme,
 * port, path, query or credentials. Returns null for anything that is not an RP ID.
 */
export function normalizeExternalPasskeyHost(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (value.startsWith('https://')) value = value.slice('https://'.length);
  if (value.endsWith('/')) value = value.slice(0, -1);
  if (!validRpId(value)) return null;
  // Nostr WoT's own credentials are stored-mode vault passkeys: Restore handles them.
  if (value === PASSKEY_RP_ID || value === LEGACY_PASSKEY_RP_ID) return null;
  return value;
}
