import { useEffect, useRef, type RefObject } from 'react';

/**
 * Close an anchored surface when the pointer goes down outside it.
 *
 * `mousedown`, not `click`, and for the same reason the shared Modal uses it:
 * a drag that starts inside the surface and ends outside is not a dismissal.
 * With `click` the listener fires on mouseup, so selecting text in a dropdown
 * and releasing past its edge closes it.
 *
 * There were four copies of this — Dropdown, AccountDropdown, GlobeButton and
 * the permissions decision popover — and they agreed by luck rather than by
 * construction.
 */
export default function useOutsideClick(
  ref: RefObject<HTMLElement | null>,
  onOutside: () => void,
  enabled = true,
): void {
  // Held in a ref so a caller passing an inline arrow does not tear the
  // listener down and rebuild it on every render.
  const onOutsideRef = useRef(onOutside);
  onOutsideRef.current = onOutside;

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutsideRef.current();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, enabled]);
}
