import { useCallback, useState } from 'react';
import { MIN_PASSWORD_LENGTH, PasswordPairProblem } from '@shared/passwordPair.ts';
import { derivePasswordPairState } from './passwordPairState.ts';

export interface UsePasswordPairResult {
  password: string;
  setPassword: (value: string) => void;
  confirm: string;
  setConfirm: (value: string) => void;
  longEnough: boolean;
  matches: boolean;
  ready: boolean;
  problem: PasswordPairProblem | null;
  /** Clears both fields — a mode toggle or a close/cancel needs this, not just unmounting. */
  reset: () => void;
}

/**
 * State + derived validity for "new password, twice".
 *
 * The pair used to be two `useState` calls plus a hand-written `longEnough` /
 * `matches` / `ready` at each of six call sites, which is how they drifted —
 * five never derived `ready` at all and refused only once the button was
 * already pressed. This is the one place that math happens now.
 *
 * TEMPORARY LOCATION: shared hooks otherwise live in `src/hooks/`, but that
 * folder had another agent's edits in flight when this was written, so this
 * one stays beside `PasswordPairFields` for now — move it once that lands.
 */
export default function usePasswordPair(minLength = MIN_PASSWORD_LENGTH): UsePasswordPairResult {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const { longEnough, matches, ready, problem } = derivePasswordPairState(password, confirm, minLength);

  const reset = useCallback(() => {
    setPassword('');
    setConfirm('');
  }, []);

  return { password, setPassword, confirm, setConfirm, longEnough, matches, ready, problem, reset };
}
