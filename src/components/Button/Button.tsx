import React from 'react';
import { cn } from '@utils/cn.ts';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /**
   * Transparent with a border in the variant's colour, rather than filled.
   *
   * A modifier rather than a fourth variant because it combines: the approval
   * sheet has a neutral outline toggle and a danger outline "reject all" side
   * by side, and as variants those would be two more names for one idea.
   */
  outline?: boolean;
  small?: boolean;
  className?: string;
  children?: React.ReactNode;
}

// `font-[inherit]` is not decoration: preflight is off, so a <button> keeps the
// UA's own font family and would not otherwise match its own label.
const BASE =
  'inline-flex items-center justify-center gap-3 rounded-md font-semibold font-[inherit] ' +
  'cursor-pointer transition-all duration-slow hover:-translate-y-0.5 active:translate-y-0 ' +
  'disabled:opacity-60 disabled:cursor-not-allowed disabled:translate-y-0';

const SIZE: Record<'default' | 'small', string> = {
  default: 'px-8 py-5 text-md',
  small: 'px-6 py-3 text-xs',
};

/**
 * Filled variants. The two shadow values on `primary` are one-off literals —
 * `rgba(0, 0, 0, …)` rather than a brand tint — and appear nowhere else in the
 * stylesheets, so they stay arbitrary values rather than inventing a token
 * with a single caller.
 */
const FILLED: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-on-brand shadow-[0_2px_8px_rgba(0,0,0,0.15)] ' +
    'hover:bg-brand-hover hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)]',
  secondary: 'bg-brand-light text-brand-hover hover:bg-[rgba(99,102,241,0.18)]',
  danger: 'bg-[rgba(220,38,38,0.1)] text-error hover:bg-[rgba(220,38,38,0.18)]',
};

/** Transparent, bordered in the variant's own colour. `danger` gets its own
 *  pair rather than reusing `--card-border` / `--text-secondary`, because a
 *  danger outline still has to read as danger. */
const OUTLINE: Record<ButtonVariant, string> = {
  primary: 'bg-transparent border border-card-border text-secondary hover:bg-card hover:text-heading',
  secondary: 'bg-transparent border border-card-border text-secondary hover:bg-card hover:text-heading',
  danger: 'bg-transparent border border-error-tint text-error hover:bg-error-tint hover:text-error',
};

export default function Button({
  variant = 'primary',
  outline = false,
  small = false,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const cls = cn(
    BASE,
    SIZE[small ? 'small' : 'default'],
    outline ? OUTLINE[variant] : FILLED[variant],
    className,
  );

  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
