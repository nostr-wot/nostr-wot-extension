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

  const copy = useCallback(async (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
    } catch {
      setCopied(false);
      setFailed(true);
    }
    timer.current = setTimeout(() => { setCopied(false); setFailed(false); }, resetAfterMs);
  }, [resetAfterMs]);

  return { copy, copied, failed };
}
