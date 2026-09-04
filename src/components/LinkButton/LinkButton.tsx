import React from 'react';

interface LinkButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** `muted` is the default; `brand` for an affordance, `danger` for removal. */
  tone?: 'muted' | 'brand' | 'danger';
  children: React.ReactNode;
}

const BASE =
  'p-0 border-none bg-transparent font-[inherit] text-xs font-medium cursor-pointer text-left ' +
  'transition-colors disabled:opacity-50 disabled:cursor-default';

/**
 * An inline action that reads as text rather than as a control.
 *
 * Distinct from Button (a filled control) and IconButton (a square hit area
 * around a glyph) — see docs/component-standards.md §1.
 */
const TONE: Record<NonNullable<LinkButtonProps['tone']>, string> = {
  muted: 'text-muted hover:text-body',
  brand: 'text-brand hover:text-brand-hover',
  danger: 'text-error hover:text-error-bright',
};

/**
 * A real `<button>`, not an anchor: it performs an action rather than
 * navigating, so it needs to be reachable by keyboard and announced as a
 * button. Styling it as text does not change what it is.
 */
export default function LinkButton({ tone = 'muted', className = '', children, ...rest }: LinkButtonProps) {
  return (
    <button type="button" className={`${BASE} ${TONE[tone]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
