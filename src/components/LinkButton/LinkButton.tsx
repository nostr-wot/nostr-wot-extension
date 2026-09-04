import React from 'react';
import styles from './LinkButton.module.css';

interface LinkButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** `muted` is the default; `brand` for an affordance, `danger` for removal. */
  tone?: 'muted' | 'brand' | 'danger';
  children: React.ReactNode;
}

/**
 * An inline action that reads as text rather than as a control.
 *
 * A real `<button>`, not an anchor: it performs an action rather than
 * navigating, so it needs to be reachable by keyboard and announced as a
 * button. Styling it as text does not change what it is.
 */
export default function LinkButton({ tone = 'muted', className = '', children, ...rest }: LinkButtonProps) {
  const toneClass = tone === 'brand' ? styles.brand : tone === 'danger' ? styles.danger : '';
  return (
    <button type="button" className={`${styles.linkButton} ${toneClass} ${className}`} {...rest}>
      {children}
    </button>
  );
}
