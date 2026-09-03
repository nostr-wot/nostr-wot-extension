import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Show a secret, blurred, and take it off the screen after a while.
 *
 * The same machine was written twice in KeyActionModal — once for the nsec at
 * 30s, once for the seed phrase at 60s — with the clear-on-timeout spelled out
 * by hand in each. That is a shape where forgetting one setter leaves the
 * secret on screen, so it is worth having once.
 *
 * The timer is cleared on unmount as well as on `clear()`. The popup is
 * destroyed on focus loss, and a pending timeout firing into an unmounted
 * component is a warning nobody will ever see — but more to the point, the
 * value is gone with the component either way, and this keeps that true no
 * matter how the modal is closed.
 */
export default function useTimedReveal<T>(empty: T, ttlMs: number) {
  const [value, setValue] = useState<T>(empty);
  const [revealed, setRevealed] = useState(false);
  const [blurred, setBlurred] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTimer = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };

  useEffect(() => stopTimer, []);

  const clear = useCallback(() => {
    stopTimer();
    setValue(empty);
    setRevealed(false);
    setBlurred(true);
    // `empty` is a caller-supplied constant ('' or []); depending on it would
    // rebuild this callback on every render for an array literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Put a secret on screen, blurred, and arm the auto-hide. */
  const reveal = useCallback((next: T) => {
    stopTimer();
    setValue(next);
    setRevealed(true);
    setBlurred(true);
    timer.current = setTimeout(clear, ttlMs);
  }, [clear, ttlMs]);

  const toggleBlur = useCallback(() => setBlurred((b) => !b), []);

  return { value, revealed, blurred, reveal, clear, toggleBlur };
}
