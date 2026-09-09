import { MIN_PASSWORD_LENGTH } from '@constants/vault.ts';
export { MIN_PASSWORD_LENGTH } from '@constants/vault.ts';

export type PasswordPairProblem = 'tooShort' | 'mismatch';

/**
 * @returns the first problem, or `null` when the pair is acceptable.
 *
 * Length is checked before the match on purpose: telling someone their
 * passwords do not match, when the real objection is that both are too short,
 * sends them to fix the wrong thing.
 */
export function validatePasswordPair(
  password: string,
  confirm: string,
  minLength = MIN_PASSWORD_LENGTH,
): PasswordPairProblem | null {
  if (password.length < minLength) return 'tooShort';
  if (password !== confirm) return 'mismatch';
  return null;
}

/*
 * The same rule, as the three booleans a form renders.
 *
 * It lived in a second file so the derivation could be tested without a React
 * harness. Both halves are pure, so that split bought nothing and cost a
 * reader one more hop to answer "what does the button wait for".
 */

export interface PasswordPairState {
  /** At least `minLength` characters. */
  longEnough: boolean;
  /** Non-empty, and identical to the password. */
  matches: boolean;
  /** `longEnough && matches` — what a submit button waits on. */
  ready: boolean;
  /**
   * `validatePasswordPair`'s code, carried through for a caller that shows one
   * message instead of the checklist (`showChecklist={false}`) — a locale
   * decision, not a validation one, same as the function it comes from.
   */
  problem: PasswordPairProblem | null;
}

/**
 * The live-checklist half of "new password, twice".
 *
 * Kept separate from `validatePasswordPair` rather than built on top of it,
 * because a checklist needs both booleans at once — it has to tick "long
 * enough" while the two passwords still differ — and `validatePasswordPair`
 * deliberately reports only the first problem, in length-before-match order.
 * That order is right for a single error message; it would hide the second
 * requirement from a checklist entirely.
 *
 * Pure so it is testable without the React tree this repo has no harness
 * for — `usePasswordPair` is the thin `useState` wrapper around it.
 */
export function derivePasswordPairState(
  password: string,
  confirm: string,
  minLength = MIN_PASSWORD_LENGTH,
): PasswordPairState {
  const longEnough = password.length >= minLength;
  const matches = password.length > 0 && password === confirm;
  return {
    longEnough,
    matches,
    ready: longEnough && matches,
    problem: validatePasswordPair(password, confirm, minLength),
  };
}
