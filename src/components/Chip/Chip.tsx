import React from 'react';
import styles from './Chip.module.css';

interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  /**
   * Colour for a chip whose meaning is the colour — a permission decision.
   * `neutral` marks selection only.
   */
  tone?: 'neutral' | 'allow' | 'deny' | 'ask';
  children: React.ReactNode;
}

/**
 * A small selectable pill.
 *
 * `aria-pressed` rather than plain button semantics: a chip is a toggle showing
 * its own state, and without it a screen reader reads only the label and gives
 * no way to tell which one is active.
 */
export default function Chip({
  selected = false, tone = 'neutral', className = '', children, ...rest
}: ChipProps) {
  const toneClass = selected ? (tone === 'neutral' ? styles.selected : styles[tone]) : '';
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`${styles.chip} ${toneClass} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
