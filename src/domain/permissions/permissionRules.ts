/**
 * Which permission rules exist, and which are worth offering.
 *
 * Deliberately separate from `permissions.ts`: that module imports `t()` for
 * its labels, which drags the whole i18n/browser layer in and makes it
 * unloadable under plain `node --test`. These are the parts that decide
 * something, so they are the parts worth testing — and they need no i18n.
 */

/**
 * The three answers a permission rule can hold.
 *
 * `tests/i18n-keys.test.ts` reads this array to check that `perms.allow`,
 * `perms.deny` and `perms.ask` exist in every locale, so it lives in one place
 * rather than in each screen that renders the chips.
 */
export const DECISIONS = ['allow', 'deny', 'ask'] as const;

/** Permission keys a read-only or remote-signer account can meaningfully hold. */
export const READ_ONLY_KEYS = ['getPublicKey'];

/**
 * Count the rules that actually decide something.
 *
 * `ask` is not a rule — it is the absence of one — so it is counted in neither
 * column. The summary line renders these counts; the strings stay at the call
 * site because they need `t()`.
 */
export function countDecisions(perms: Record<string, string>): { allow: number; deny: number } {
  let allow = 0, deny = 0;
  for (const v of Object.values(perms)) {
    if (v === 'allow') allow++;
    else if (v === 'deny') deny++;
  }
  return { allow, deny };
}

/**
 * Narrow the offerable permission keys to what the selected account could use.
 *
 * A read-only (npub) account holds no private key and a NIP-46 account delegates
 * signing to a remote signer, so every key except `getPublicKey` would be a rule
 * that can never fire. In global mode the rules apply across all accounts, so
 * nothing is narrowed.
 */
export function filterKeysForAccountKind(
  keys: string[],
  kind: { readOnly?: boolean; nip46?: boolean },
  globalMode = false,
): string[] {
  if (globalMode || (!kind.readOnly && !kind.nip46)) return keys;
  return keys.filter((k) => READ_ONLY_KEYS.includes(k));
}

/** Permission keys not already set for this domain — what "Add rule" may offer. */
export function availablePermKeys(all: string[], existing: Record<string, string>): string[] {
  return all.filter((k) => !(k in existing));
}

/** The key an Add-rule form is describing, preset or hand-typed kind. */
export function buildRuleKey(preset: string, customKind: string, useCustom: boolean): string {
  return useCustom ? `signEvent:${customKind.trim()}` : preset;
}

/** A custom event kind must be a complete integer, never a partially typed number. */
export function validCustomKind(value: string): boolean {
  return /^\d+$/.test(value.trim()) && Number(value) <= 65535;
}
