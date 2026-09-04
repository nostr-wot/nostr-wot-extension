import React from 'react';
import styles from './Select.module.css';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: SelectOption[];
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
  small?: boolean;
  className?: string;
}

// `font-[inherit]` is not decoration: preflight is off, so a <select> keeps
// the UA's own font family and would not otherwise match its own label.
// `styles.select` still carries the custom chevron (background-image,
// `appearance: none`) and nothing else — see Select.module.css for why that
// one declaration stays real CSS. Padding-right is widened with a plain
// utility per size to leave room for it, rather than through the module, so
// nothing here depends on cross-stylesheet cascade order.
const BASE =
  'w-full border border-card-active rounded-md text-md font-[inherit] cursor-pointer ' +
  'bg-brand-tint-hover text-heading transition-all duration-slow ' +
  'focus:outline-none focus:border-brand focus:bg-card focus:shadow-focus';

export default function Select({ options, value, onChange, small = false, className = '', ...rest }: SelectProps) {
  const cls = [
    BASE,
    styles.select,
    small ? 'py-3 pl-5 pr-14 text-xs' : 'py-5 pl-6 pr-16',
    className,
  ].filter(Boolean).join(' ');
  return (
    <select className={cls} value={value} onChange={onChange} {...rest}>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}
