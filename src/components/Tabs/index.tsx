import type { ReactNode } from 'react';
import type { Option } from '@components/option.ts';
import { cn } from '@utils/cn.ts';

// Shared outlined, segmented and icon-card choices use the same selection behavior.
const TAB_BASE = 'disabled:opacity-50 disabled:cursor-default flex-1 bg-transparent cursor-pointer font-[inherit] text-sm font-semibold transition-all';

const VARIANT_WRAP: Record<string, string> = {
  outlined: 'flex gap-2',
  cards: 'flex gap-3',
  segmented: 'flex gap-1 p-[3px] bg-card border border-card-border rounded-panel',
};

const VARIANT_TAB: Record<string, string> = {
  cards: 'flex flex-col items-center gap-3 py-7 px-4 border-[1.5px] border-card-border rounded-lg text-secondary hover:bg-card',
  outlined: 'px-6 py-4 border-[1.5px] border-card-border rounded-md text-secondary',
  segmented: 'py-[7px] px-0 border-none rounded-md text-muted',
};

const VARIANT_TAB_ACTIVE: Record<string, string> = {
  cards: 'border-brand bg-brand-tint-active text-brand',
  outlined: 'border-brand bg-brand-tint-active text-brand',
  segmented: 'bg-elevated text-brand shadow-[0_1px_3px_rgba(0,0,0,0.08)]',
};

interface TabsProps<T extends string = string> {
  options: readonly (Option<T> & { icon?: ReactNode })[];
  value: T;
  onChange: (value: T) => void;
  /** Bordered segments, a single track, or icon cards for settings choices. */
  variant?: 'outlined' | 'segmented' | 'cards';
  disabled?: boolean;
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
  options, value, onChange, variant = 'outlined', label, disabled = false, className = '',
}: TabsProps<T>) {
  return (
    <div className={cn(VARIANT_WRAP[variant], className)} role="tablist" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          disabled={disabled}
          aria-selected={opt.value === value}
          className={cn(TAB_BASE, VARIANT_TAB[variant], opt.value === value ? VARIANT_TAB_ACTIVE[variant] : '')}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon && <span aria-hidden="true">{opt.icon}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
