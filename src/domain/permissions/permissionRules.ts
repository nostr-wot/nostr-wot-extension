import { READ_ONLY_KEYS } from '@constants/permissions.ts';
export { DECISIONS, READ_ONLY_KEYS } from '@constants/permissions.ts';

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
