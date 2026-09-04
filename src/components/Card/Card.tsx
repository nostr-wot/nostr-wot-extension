import React from 'react';
import styles from './Card.module.css';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * `raised` — frosted and lifted; the default, and what most content sits on.
   * `flat` — tinted and flush, for surfaces nested inside a raised one.
   * `elevated` — opaque, for a surface that must not let anything show through.
   */
  variant?: 'raised' | 'flat' | 'elevated';
  className?: string;
  children?: React.ReactNode;
}

export default function Card({ variant = 'raised', className = '', children, ...rest }: CardProps) {
  return (
    <div className={`${styles.card} ${styles[variant]} ${className}`} {...rest}>
      {children}
    </div>
  );
}
