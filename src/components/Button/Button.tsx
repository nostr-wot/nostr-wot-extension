import React from 'react';
import styles from './Button.module.css';

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

export default function Button({
  variant = 'primary',
  outline = false,
  small = false,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const cls = [
    styles.btn,
    styles[variant],
    outline && styles.outline,
    small && styles.small,
    className,
  ].filter(Boolean).join(' ');

  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
