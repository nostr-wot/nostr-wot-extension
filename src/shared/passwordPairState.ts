import { validatePasswordPair, MIN_PASSWORD_LENGTH, PasswordPairProblem } from '@shared/passwordPair.ts';

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
