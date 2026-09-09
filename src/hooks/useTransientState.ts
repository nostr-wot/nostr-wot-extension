import { useCallback, useEffect, useMemo, useState } from 'react';
import { createResettableTimeout } from '@utils/resettableTimeout.ts';

/** Temporary feedback with replacement-safe timing and unmount cleanup. */
export default function useTransientState<T>(initial: T, delay: number) {
  const [value, setValue] = useState(initial);
  const timer = useMemo(createResettableTimeout, []);
  useEffect(() => timer.clear, [timer]);
  const set = useCallback((next: T) => {
    timer.clear();
    setValue(next);
    if (!Object.is(next, initial)) timer.schedule(() => setValue(initial), delay);
  }, [initial, delay, timer]);
  return [value, set] as const;
}
