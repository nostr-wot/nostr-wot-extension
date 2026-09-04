import React from 'react';
import styles from './Tabs.module.css';

export interface TabOption<T extends string = string> {
  value: T;
  label: string;
}

interface TabsProps<T extends string = string> {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** `outlined` — separate bordered segments. `segmented` — one track, moving thumb. */
  variant?: 'outlined' | 'segmented';
  /** Names the group for assistive tech, e.g. "Wallet setup method". */
  label?: string;
  className?: string;
}

/**
 * A row of mutually exclusive choices that swap the panel beneath them.
 *
 * `role="tablist"` with `aria-selected`, which neither hand-rolled copy had:
 * a row of plain buttons gives a screen reader no way to know the options are
 * exclusive, nor which one is currently showing.
 */
export default function Tabs<T extends string = string>({
  options, value, onChange, variant = 'outlined', label, className = '',
}: TabsProps<T>) {
  return (
    <div className={`${styles.tabs} ${styles[variant]} ${className}`} role="tablist" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={opt.value === value}
          className={`${styles.tab} ${opt.value === value ? styles.tabActive : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
