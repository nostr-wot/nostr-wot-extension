/**
 * Signing permissions — a thin adapter over `@nostr-wot/permissions`.
 *
 * The cascade, the storage model, the cache and the migrations all live in the package now.
 * What is left here is the extension's own calling convention: module functions rather than
 * an instance, `domain` rather than `origin`, and an optional `accountId`. The package is
 * the implementation; this file is a shape.
 *
 * Storage model and resolution are unchanged, and deliberately so — the keys
 * (`signerPermissions`, `signerUseGlobalDefaults`) are wire format, and a rename resets
 * every decision a user ever made:
 *
 *   { "origin": { "_default": { "signEvent:1": "allow" }, "acctId": { ... } } }
 *
 * Three behaviours DID change, because the package fails closed where the extension did
 * not. Each is called out at its call site below:
 *
 *   1. `accountId` is required by the package. Omitting it in per-account mode no longer
 *      silently reads and writes the bucket every account shares.
 *   2. `migrateToPerKind` now keeps a blanket `deny`. It only ever dropped blanket GRANTS
 *      as unrepresentable; dropping the denials as well wiped a remembered "deny, every
 *      kind" on every migration-version bump.
 *   3. A `signEvent` check that cannot name an integer kind resolves from the deny levels
 *      alone, so a broad `allow` cannot answer for a kind the caller failed to state.
 *
 * @see https://github.com/nostr-protocol/nips/blob/master/07.md -- NIP-07
 * @module services/permissions/permissions
 */
import {
  Permissions,
  canonicalHostname,
  canonicalHttpOrigin,
  permissionKey as packagePermissionKey,
  type PermissionBucket,
  type PermissionDecision,
  type PermissionMap,
  type OriginPermissions as DomainPermissions,
} from '@nostr-wot/permissions';
import { localStore } from '@services/storage/keyValueStore.ts';

// Re-exported as local aliases rather than `export … from`: this repo forbids forwarding
// barrels (tests/test-registration.test.ts), and the callers that want these types want
// them alongside the functions that return them.
export type {
  PermissionDecision,
  PermissionBucket,
  PermissionMap,
  DomainPermissions,
};

/**
 * One instance over the extension's `local` area.
 *
 * The store's `subscribe` is what keeps the popup's copy of this module and the service
 * worker's from disagreeing: each invalidates its cache when the other writes.
 */
const permissions = new Permissions(localStore, {
  logger: { warn: (message, context) => console.warn('[PERMISSIONS]', message, context) },
});

/**
 * The label a caller's rules are read and written under.
 *
 * `Permissions.check` reads the origin **as given**: it folds an http(s) origin to its
 * canonical spelling but leaves a bare hostname alone, so `check('EXAMPLE.COM', …)` would
 * miss a deny stored for `example.com`. `@nostr-wot/signer-core` canonicalises at its own
 * boundary, and this extension is a direct caller, so it has to do the same — the package
 * says so, and exports these two for exactly this. Anything that is neither an http(s)
 * origin nor a hostname (an internal label) is its own key and passes through untouched.
 */
function label(domain: string): string {
  return canonicalHttpOrigin(domain) ?? canonicalHostname(domain) ?? domain;
}

/**
 * The account bucket to use, as the package wants it.
 *
 * `''` is not `_default`. In global-defaults mode the package ignores it and uses the
 * shared bucket, which is correct by definition. In per-account mode it resolves to no
 * bucket at all: a read answers `ask` and a write throws, instead of the extension's old
 * `accountId || '_default'`, which quietly handed a request with no account the grants
 * every account shares. That divergence is the point of the package's account dimension
 * and is carried through here rather than undone.
 */
function bucket(accountId?: string): string {
  return accountId ?? '';
}

/** Invalidate the cached tree and mode flag (after an out-of-band write, or in test setup). */
export function invalidateCache(): void {
  permissions.invalidateCache();
}

/**
 * Map a NIP-07 wire method to the logical permission key that governs it.
 *
 * The package types `kind` against the method literal, so a `signEvent` read must name an
 * integer kind; this signature keeps the extension's looser one (`method: string`) and
 * narrows on the way in, because several call sites only know the method at runtime.
 *
 * @param method - e.g. "signEvent", "nip04Encrypt"
 * @param kind - event kind for signEvent; null names the blanket key
 */
export function permissionKey(method: string, kind?: number | null): string {
  if (method === 'signEvent') return packagePermissionKey('signEvent', kind ?? null);
  return packagePermissionKey(method as Exclude<string, 'signEvent'>);
}

/**
 * Check permission for a domain/method/kind combo with account awareness.
 *
 * @param domain - the caller's origin
 * @param method - e.g. "signEvent", "nip04Encrypt"
 * @param kind - event kind (for signEvent)
 * @param accountId - the account the request is for; see {@link bucket}
 * @returns "allow" | "deny" | "ask"
 */
export async function check(
  domain: string,
  method: string,
  kind?: number,
  accountId?: string,
): Promise<PermissionDecision> {
  if (method === 'signEvent') {
    // Passed through even when it is not an integer: the package answers such a read from
    // the deny levels alone rather than letting a wildcard `allow` speak for a kind the
    // caller did not state.
    return permissions.check(label(domain), 'signEvent', kind as number, bucket(accountId));
  }
  return permissions.check(label(domain), method as Exclude<string, 'signEvent'>, undefined, bucket(accountId));
}

/**
 * Save a permission decision using permissionKey mapping.
 * @param decision - "allow" | "deny"
 */
export async function save(
  domain: string,
  method: string,
  kind: number | null,
  decision: PermissionDecision,
  accountId?: string,
): Promise<void> {
  if (method === 'signEvent') {
    await permissions.save(label(domain), 'signEvent', kind, decision, bucket(accountId));
    return;
  }
  await permissions.save(label(domain), method as Exclude<string, 'signEvent'>, undefined, decision, bucket(accountId));
}

/**
 * Save a permission decision under a key verbatim (for UI use).
 * @param key - permission key as-is (e.g. "signEvent:1", "sendMessages")
 */
export async function saveDirect(
  domain: string,
  key: string,
  decision: PermissionDecision,
  accountId?: string,
): Promise<void> {
  await permissions.saveDirect(label(domain), key, decision, bucket(accountId));
}

/**
 * Drop the blanket grants the per-kind model retired.
 *
 * A blanket `deny` now survives. The extension deleted those too, and because the
 * migration re-runs whenever the stored `_permMigrationVersion` differs, every version bump
 * wiped a user's remembered "deny, every kind" — which is exactly the decision least
 * defensible to lose.
 */
export async function migrateToPerKind(): Promise<void> {
  await permissions.migrateToPerKind();
}

/** Wrap flat per-domain permissions under "_default". Idempotent. */
export async function migrateToPerAccount(): Promise<void> {
  await permissions.migrateToPerAccount();
}

/** Rewrite the retired "forward" decision to "ask". */
export async function migrateForwardToAsk(): Promise<void> {
  await permissions.migrateForwardToAsk();
}

/** Fold stored signEvent:4/:13/:14/:1059 entries into "sendMessages", most restrictive wins. */
export async function migrateDmKindsToSendMessages(): Promise<void> {
  await permissions.migrateDmKindsToSendMessages();
}

/**
 * Clear permissions for a domain (optionally per-account), or all permissions.
 * @param domain - omitted means every rule there is
 */
export async function clear(domain?: string, accountId?: string): Promise<void> {
  await permissions.clear(domain === undefined ? undefined : label(domain), bucket(accountId));
}

/**
 * Remove every stored permission for a domain, across all account buckets.
 *
 * Disconnecting is a full revocation: `clear()` only touches the active mode's bucket,
 * which would leave another account's rules behind for a site the user just disconnected.
 */
export async function clearAllForDomain(domain: string): Promise<void> {
  if (!domain) return;
  await permissions.clearAllForOrigin(label(domain));
}

/** Remove all permission overrides for a specific account across all domains. */
export async function clearForAccount(accountId: string): Promise<void> {
  if (!accountId) return;
  await permissions.clearForAccount(accountId);
}

/** Deep-copy permissions from one account to another. `null` means the shared bucket. */
export async function copyPermissions(fromAccountId: string | null, toAccountId: string): Promise<void> {
  if (!toAccountId) return;
  await permissions.copyPermissions(fromAccountId, toAccountId);
}

/**
 * Set up permissions for a freshly created account so the wizard's "Start fresh" /
 * "Copy from" choice is actually honored.
 */
export async function setupNewAccountPermissions(
  newAccountId: string,
  existingAccountIds: string[],
  copyFromAccountId: string | null,
): Promise<void> {
  if (!newAccountId) return;
  await permissions.setupNewAccountPermissions(newAccountId, existingAccountIds, copyFromAccountId);
}

/** All permissions for the active mode's bucket: { domain: { permKey: decision } }. */
export async function getAll(accountId?: string): Promise<Record<string, PermissionBucket>> {
  return permissions.getAll(bucket(accountId));
}

/** One domain's effective permissions in the active mode's bucket, legacy scopes folded in. */
export async function getForDomain(domain: string, accountId?: string): Promise<PermissionBucket> {
  return permissions.getForOrigin(label(domain), bucket(accountId));
}

/** The raw storage tree for all domains (for computing diff indicators in the UI). */
export async function getAllRaw(): Promise<PermissionMap> {
  return permissions.getAllRaw();
}

/** The raw buckets for a single domain (for diff computation). */
export async function getForDomainRaw(domain: string): Promise<DomainPermissions> {
  return permissions.getForOriginRaw(label(domain));
}

/**
 * Whether global default permissions mode is active.
 * When true, ONLY the _default bucket is used for reads and writes.
 */
export async function getUseGlobalDefaults(): Promise<boolean> {
  return permissions.getUseGlobalDefaults();
}

/** Turn global default permissions mode on or off. Dormant buckets are left alone. */
export async function setUseGlobalDefaults(enabled: boolean): Promise<void> {
  await permissions.setUseGlobalDefaults(enabled);
}
