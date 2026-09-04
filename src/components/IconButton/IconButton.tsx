import React from 'react';
import { cn } from '@utils/cn.ts';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Resting colour. `brand` for primary affordances, `danger` for removals. */
  tone?: 'muted' | 'brand' | 'danger';
  /** Square hit area in px. */
  size?: number;
  children: React.ReactNode;
}

const DEFAULT_SIZE = 28;

// `font-[inherit]` is not decoration: preflight is off, so a <button> keeps
// the UA's own font family.
const BASE =
  'flex items-center justify-center shrink-0 p-0 border-none rounded-md bg-transparent ' +
  'cursor-pointer font-[inherit] transition-all disabled:opacity-50 disabled:cursor-default';

/**
 * Colour and size are props because they genuinely differ — the top bar's are
 * brand-coloured, dialog closes are muted, and removals are destructive.
 *
 * Each tone owns its full hover state (background *and* text colour) rather
 * than layering a tone-specific override on a shared `hover:bg-card`: two
 * `hover:bg-*` utilities on one element race on Tailwind's generation order,
 * not on the order they're written here, and that race is not worth having.
 */
const TONE: Record<NonNullable<IconButtonProps['tone']>, string> = {
  muted: 'text-muted hover:bg-card hover:text-heading',
  brand: 'text-brand hover:bg-card hover:text-brand-hover',
  danger: 'text-muted hover:bg-error-tint hover:text-error',
};

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
  tone = 'muted', size, className = '', children, ...rest
}: IconButtonProps) {
  // The hit area is a caller-supplied number, known only at render — same
  // reasoning as Spinner's diameter: no utility class can be generated for it.
  const px = size ?? DEFAULT_SIZE;

  return (
    <button
      type="button"
      className={cn(BASE, TONE[tone], className)}
      style={{ width: px, height: px }}
      {...rest}
    >
      {children}
    </button>
  );
}
