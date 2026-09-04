import React from 'react';
import styles from './IconButton.module.css';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Resting colour. `brand` for primary affordances, `danger` for removals. */
  tone?: 'muted' | 'brand' | 'danger';
  /** Square hit area in px. */
  size?: number;
  children: React.ReactNode;
}

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
  const style = size ? ({ '--icon-button-size': `${size}px` } as React.CSSProperties) : undefined;
  const toneClass = tone === 'brand' ? styles.brand : tone === 'danger' ? styles.danger : '';

  return (
    <button type="button" className={`${styles.iconButton} ${toneClass} ${className}`} style={style} {...rest}>
      {children}
    </button>
  );
}
