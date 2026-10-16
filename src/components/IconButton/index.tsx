import React from 'react';
import { cn } from '@utils/cn.ts';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Resting colour. `brand` for primary affordances, `danger` for removals, `error` for always-red exits. */
  tone?: 'muted' | 'brand' | 'danger' | 'success' | 'warning' | 'error';
  /** Standard square hit areas: 24, 28 and 36 pixels. */
  size?: 'small' | 'default' | 'large';
  /** Card surface and border, for a row of standalone actions. */
  framed?: boolean;
  /** Label shown below on hover and keyboard focus; also the accessible name unless `aria-label` is given. */
  tooltip?: string;
  children: React.ReactNode;
}

const SIZE = { small: 24, default: 28, large: 36 } as const;

// `font-[inherit]` is not decoration: preflight is off, so a <button> keeps
// the UA's own font family.
const BASE =
  'flex items-center justify-center shrink-0 p-0 border-none rounded-md bg-transparent ' +
  'cursor-pointer font-[inherit] transition-colors focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * Colour and size are props because they genuinely differ — the top bar's are
 * brand-coloured, dialog closes are muted, and removals are destructive.
 *
 * Each tone owns its full hover state (background *and* text colour) rather
 * than layering a tone-specific override on a shared `enabled:hover:bg-card`: two
 * `enabled:hover:bg-*` utilities on one element race on Tailwind's generation order,
 * not on the order they're written here, and that race is not worth having.
 */
const TONE: Record<NonNullable<IconButtonProps['tone']>, string> = {
  muted: 'text-muted enabled:hover:bg-hover enabled:hover:text-heading',
  brand: 'text-brand enabled:hover:bg-hover enabled:hover:text-brand-hover',
  success: 'text-success enabled:hover:bg-hover',
  warning: 'text-warning enabled:hover:bg-hover',
  danger: 'text-muted enabled:hover:bg-error-tint enabled:hover:text-error',
  error: 'text-error enabled:hover:bg-error-tint',
};

const FRAMED = 'border border-solid border-card-border bg-card';
const TOOLTIP = 'pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 z-10 whitespace-nowrap ' +
  'bg-page-solid border border-card-border rounded-sm px-4 py-2 text-xs font-normal text-body ' +
  'shadow-[0_2px_8px_rgba(0,0,0,0.12)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100';

/**
 * A button that is only an icon.
 *
 * There were seventeen near-identical rule blocks for this — every dialog
 * close, the top bar's controls, the copy and remove affordances — differing
 * mostly in colour and by a pixel or two of padding. `aria-label` is worth
 * passing on every one of them: the label is the icon, and an icon has no
 * accessible name.
 */
export default function IconButton({
  tone = 'muted', size = 'default', framed = false, tooltip, className = '', children, ...rest
}: IconButtonProps) {
  const px = SIZE[size];

  return (
    <button
      type="button"
      className={cn(BASE, TONE[tone], framed && FRAMED, tooltip && 'relative group', className)}
      style={{ width: px, height: px }}
      aria-label={tooltip}
      {...rest}
    >
      {children}
      {tooltip && <span aria-hidden="true" className={TOOLTIP}>{tooltip}</span>}
    </button>
  );
}
