import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /**
   * `raised` — frosted and lifted; the default, and what most content sits on.
   * `flat` — tinted and flush, for surfaces nested inside a raised one.
   * `elevated` — opaque, for a surface that must not let anything show through.
   */
  variant?: 'raised' | 'flat' | 'elevated';
  /**
   * Element to render. `div` (default) for a static or mouse-clickable
   * surface. `button` when the whole card *is* the action — a handful of
   * cards (the wizard's method picker, an approval-queue row) are really
   * buttons wearing card styling, and rendering a `div` with `onClick` would
   * drop native keyboard activation and focus for them.
   */
  as?: 'div' | 'button';
  className?: string;
  children?: React.ReactNode;
}

const BASE = 'border border-card-border rounded-lg p-7 mb-6';

/** Three variants because three genuinely exist in the product, not because a
 *  prop seemed nice — see docs/component-standards.md §1. */
const VARIANT: Record<NonNullable<CardProps['variant']>, string> = {
  raised: 'bg-glass backdrop-blur-[8px] shadow-card',
  flat: 'bg-card',
  elevated: 'bg-elevated shadow-card',
};

export default function Card({ variant = 'raised', as = 'div', className = '', children, ...rest }: CardProps) {
  const Tag = as;
  return (
    <Tag
      className={`${BASE} ${VARIANT[variant]} ${className}`}
      {...(as === 'button' ? { type: 'button' as const } : {})}
      {...rest}
    >
      {children}
    </Tag>
  );
}
