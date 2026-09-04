import type { SVGProps } from 'react';

/**
 * Props every icon in `src/assets/` takes.
 *
 * Declared 29 times — once per icon, byte-identical each time. Adding a prop to
 * the set meant editing 29 files, so in practice nobody did, and any icon that
 * did grow one would have diverged silently from the rest.
 */
export interface IconProps extends SVGProps<SVGSVGElement> {
  /** Both width and height; icons here are square. */
  size?: number;
}
