/**
 * The "new password, twice" rule.
 *
 * Written out by hand at eight call sites — every encrypted export, the vault
 * creation step and the change-password form — with the length and the order of
 * the two checks repeated each time. The rule itself is trivial; having eight
 * copies of it is how one of them ends up checking `<= 8`, or checking the match
 * before the length and telling the user the wrong thing first.
 *
 * Returns a code rather than a message: the same rule is phrased differently
 * depending on the screen (`key.passwordMin8`, `wizard.minChars`,
 * `key.newPasswordMin8`), and that is a locale decision, not a validation one.
 */

export const MIN_PASSWORD_LENGTH = 8;

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
