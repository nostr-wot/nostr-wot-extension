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
  /** Joined halves of a split action; appearance stays owned by Button. */
  segment?: 'start' | 'end';
  className?: string;
  children?: React.ReactNode;
}

// `font-[inherit]` is not decoration: preflight is off, so a <button> keeps the
// UA's own font family and would not otherwise match its own label.
const BASE =
  'inline-flex items-center justify-center gap-3 rounded-md font-semibold font-[inherit] ' +
  'cursor-pointer leading-normal transition-colors duration-150 ' +
  'focus-visible:outline-none focus-visible:shadow-focus ' +
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none';

const SIZE: Record<'default' | 'small', string> = {
  default: 'min-h-20 px-7 py-4 text-md',
  small: 'min-h-16 px-5 py-3 text-sm',
};

/** Filled actions keep a quiet surface; hover only applies when enabled. */
const FILLED: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-on-brand enabled:hover:bg-brand-hover enabled:active:bg-brand-hover',
  secondary: 'bg-brand-light text-brand-hover enabled:hover:bg-[rgba(99,102,241,0.18)]',
  danger: 'bg-[rgba(220,38,38,0.1)] text-error enabled:hover:bg-[rgba(220,38,38,0.18)]',
};

/** Transparent, bordered in the variant's own colour. `danger` gets its own
 *  pair rather than reusing `--card-border` / `--text-secondary`, because a
 *  danger outline still has to read as danger. */
const OUTLINE: Record<ButtonVariant, string> = {
  primary: 'bg-transparent border border-card-border text-secondary enabled:hover:bg-card enabled:hover:text-heading',
  secondary: 'bg-transparent border border-card-border text-secondary enabled:hover:bg-card enabled:hover:text-heading',
  danger: 'bg-transparent border border-error-tint text-error enabled:hover:bg-error-tint enabled:hover:text-error',
};

export function Button({
  variant = 'primary',
  outline = false,
  small = false,
  segment,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const cls = cn(
    BASE,
    SIZE[small ? 'small' : 'default'],
    outline ? OUTLINE[variant] : ['border-0', FILLED[variant]],
    segment === 'start' && 'rounded-r-none',
    segment === 'end' && 'rounded-l-none border-l border-l-current/20',
    className,
  );

  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

/** Named presets share Button's styling, sizing, accessibility and native props. */
export function ButtonSecondary(props: Omit<ButtonProps, 'variant'>) {
  return <Button {...props} variant="secondary" />;
}

export function ButtonDanger(props: Omit<ButtonProps, 'variant'>) {
  return <Button {...props} variant="danger" />;
}

export default Button;
