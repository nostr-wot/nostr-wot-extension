import React, { useState } from 'react';
import { t } from '@lib/i18n.js';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type?: 'text' | 'password' | 'number';
  mono?: boolean;
  small?: boolean;
  center?: boolean;
  showToggle?: boolean;
  label?: string;
  error?: string;
  className?: string;
}

// `font-[inherit]` is not decoration: preflight is off, so an <input> keeps
// the UA's own font family and would not otherwise match its own label.
const BASE =
  'w-full border border-card-active rounded-md text-md font-[inherit] transition-all duration-slow ' +
  'bg-brand-tint-hover text-heading placeholder:text-muted ' +
  'focus:outline-none focus:border-brand focus:bg-card focus:shadow-focus';

export default function Input({
  type = 'text',
  mono = false,
  small = false,
  center = false,
  showToggle = false,
  label,
  error,
  className = '',
  ...rest
}: InputProps) {
  const [visible, setVisible] = useState<boolean>(false);
  const effectiveType = type === 'password' && visible ? 'text' : type;

  const cls = [
    BASE,
    small ? 'py-3 px-4 text-sm' : 'py-5 px-6',
    mono && 'font-mono text-xs',
    center && 'text-center',
    className,
  ].filter(Boolean).join(' ');

  const input = (
    <div className="relative w-full">
      <input type={effectiveType} className={cls} {...rest} />
      {type === 'password' && showToggle && (
        <button
          type="button"
          tabIndex={-1}
          className="absolute right-4 top-1/2 -translate-y-1/2 bg-transparent border-none text-brand text-xs font-semibold font-[inherit] cursor-pointer py-1 px-3"
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? t('common.hide') : t('common.show')}
        </button>
      )}
    </div>
  );

  if (!label && !error) return input;

  return (
    <div className="flex flex-col gap-2">
      {label && <label className="text-sm font-semibold text-secondary">{label}</label>}
      {input}
      {error && <div className="text-xs text-error">{error}</div>}
    </div>
  );
}
