import type { Option } from '@components/option.ts';
import React from 'react';
import IconChevronDown from '@assets/IconChevronDown.tsx';
import { cn } from '@utils/cn.ts';

interface SelectOption extends Option { disabled?: boolean }
interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: readonly SelectOption[];
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  small?: boolean;
  className?: string;
}

/** Native selection keeps keyboard navigation, type-ahead and platform menus. */
export default function Select({ options, value, onChange, small = false, className = '', ...rest }: SelectProps) {
  return (
    <div className="relative w-full min-w-0">
      <select
        className={cn(
          'appearance-none w-full min-w-0 border border-control-border rounded-md font-[inherit] leading-normal ' +
          'bg-input text-heading cursor-pointer transition-colors duration-150 ' +
          'enabled:hover:border-brand focus:outline-none focus:border-brand focus:shadow-focus ' +
          'disabled:opacity-50 disabled:cursor-not-allowed',
          small ? 'min-h-16 py-3 pl-5 pr-16 text-sm' : 'min-h-20 py-4 pl-6 pr-18 text-md',
          className,
        )}
        value={value} onChange={onChange} {...rest}
      >
        {options.map(opt => <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>)}
      </select>
      <IconChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-secondary" />
    </div>
  );
}
