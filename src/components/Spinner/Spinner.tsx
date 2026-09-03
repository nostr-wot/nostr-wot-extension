import React from 'react';
import styles from './Spinner.module.css';

interface SpinnerProps {
  /** Diameter in px. */
  size?: number;
  /** Ring thickness in px; scales with the size when not given. */
  border?: number;
  className?: string;
}

/** An indeterminate loading ring. */
export default function Spinner({ size = 20, border, className = '' }: SpinnerProps) {
  const style = {
    '--spinner-size': `${size}px`,
    '--spinner-border': `${border ?? Math.max(2, Math.round(size / 10))}px`,
  } as React.CSSProperties;

  return <div className={`${styles.spinner} ${className}`} style={style} role="status" aria-live="polite" />;
}
