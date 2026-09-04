import React from 'react';

export interface TabOption<T extends string = string> {
  value: T;
  label: string;
}

// Two variants because the product genuinely has two tab designs, and
// choosing one for both is a design decision rather than a refactor. The old
// `.outlined .tab` / `.segmented .tabActive` descendant rules are resolved
// here instead — the component already knows its own variant and active
// state, so there is no reason to reach for a CSS selector to do it.
const TAB_BASE = 'flex-1 bg-transparent cursor-pointer font-[inherit] text-sm font-semibold transition-all';

const VARIANT_WRAP: Record<string, string> = {
  outlined: 'flex gap-2',
  segmented: 'flex gap-1 p-[3px] bg-card border border-card-border rounded-panel',
};

const VARIANT_TAB: Record<string, string> = {
  outlined: 'px-6 py-4 border-[1.5px] border-card-border rounded-md text-secondary',
  segmented: 'py-[7px] px-0 border-none rounded-md text-muted',
};

const VARIANT_TAB_ACTIVE: Record<string, string> = {
  outlined: 'border-brand bg-brand-tint-active text-brand',
  segmented: 'bg-elevated text-brand shadow-[0_1px_3px_rgba(0,0,0,0.08)]',
};

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
    <div className={`${VARIANT_WRAP[variant]} ${className}`} role="tablist" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={opt.value === value}
          className={`${TAB_BASE} ${VARIANT_TAB[variant]} ${opt.value === value ? VARIANT_TAB_ACTIVE[variant] : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
