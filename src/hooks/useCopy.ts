import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Copy to the clipboard, and say whether it worked.
 *
 * The popup had eleven hand-rolled versions of this. Most were fine; the ones
 * that were not were the three in KeyActionModal, which copy an nsec, an
 * ncryptsec and a seed phrase without awaiting the write or catching it — so on
 * the values a user cannot eyeball to check, a denied clipboard looked exactly
 * like a successful copy.
 *
 * `copied` returns to false on its own so callers do not each need a timer, and
 * the timer is cleared on unmount because the popup is destroyed on focus loss
 * and a pending setState after that is a warning nobody will see.
 */
export default function useCopy(resetAfterMs = 2000) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /**
   * Resolves to whether the write actually landed.
   *
   * `copied` is the right thing to render, but it is state — it is not readable
   * by the caller until the next render, so a caller that has to *decide*
   * something on the result (the wizard only marks a seed phrase backed up if
   * the copy worked) cannot use it. Returning the outcome keeps that decision
   * honest without making every caller re-implement the try/catch.
   */
  const copy = useCallback(async (value: string): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    let ok = true;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
    } catch {
      ok = false;
      setCopied(false);
      setFailed(true);
    }
    timer.current = setTimeout(() => { setCopied(false); setFailed(false); }, resetAfterMs);
    return ok;
  }, [resetAfterMs]);

  return { copy, copied, failed };
}
