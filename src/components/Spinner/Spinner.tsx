import React from 'react';

/**
 * An indeterminate loading ring.
 *
 * There were four of these, differing only in width, border thickness and
 * duration — none of which was a decision anyone made twice on purpose.
 *
 * Size and thickness stay inline styles rather than utilities: they are
 * caller-supplied numbers, and a utility class cannot be generated from a value
 * that is only known at runtime.
 */

interface SpinnerProps {
  /** Diameter in px. */
  size?: number;
  /** Ring thickness in px; scales with the size when not given. */
  border?: number;
  className?: string;
}

export default function Spinner({ size = 20, border, className = '' }: SpinnerProps) {
  return (
    <div
      className={`rounded-full border-card-border border-t-brand animate-spin [animation-duration:0.7s] ${className}`}
      style={{
        width: size,
        height: size,
        borderWidth: border ?? Math.max(2, Math.round(size / 10)),
        borderStyle: 'solid',
      }}
      role="status"
      aria-live="polite"
    />
  );
}
