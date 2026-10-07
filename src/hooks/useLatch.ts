import { useState } from 'react';

/**
 * False until `value` is first true, then true for the rest of the mount.
 *
 * For lazily loaded overlays: render one only once it has been asked for, and
 * keep it rendered afterwards so its exit animation and state survive closing.
 */
export function useLatch(value: boolean): boolean {
  const [latched, setLatched] = useState(value);
  if (value && !latched) setLatched(true);
  return latched || value;
}
