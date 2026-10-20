import InfoTooltip from '@components/InfoTooltip';
import React, { useState, useId } from 'react';
import { t } from '@services/i18n/i18n.ts';
import { cn } from '@utils/cn.ts';
import Container from '@components/Container';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type?: 'text' | 'password' | 'number' | 'search' | 'date' | 'file';
  mono?: boolean;
  small?: boolean;
  center?: boolean;
  showToggle?: boolean;
  /** Icon buttons, each at most 36px wide, inside the trailing edge. */
  actions?: React.ReactElement[];
  label?: string;
  hint?: string;
  error?: string;
  className?: string;
}

// `font-[inherit]` is not decoration: preflight is off, so an <input> keeps
// the UA's own font family and would not otherwise match its own label.
export const INPUT_BASE =
  'w-full min-w-0 border border-control-border rounded-md text-md font-[inherit] leading-normal ' +
  'bg-input text-heading placeholder:text-muted transition-colors duration-150 ' +
  'enabled:hover:border-brand focus:outline-none focus:border-control-focus focus:shadow-focus ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

export default function Input({
  type = 'text',
  mono = false,
  small = false,
  center = false,
  showToggle = false,
  actions = [],
  label,
  hint,
  error,
  className = '',
  id,
  ...rest
}: InputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const errorId = `${inputId}-error`;
  const [visible, setVisible] = useState<boolean>(false);
  const effectiveType = type === 'password' && visible ? 'text' : type;

  const cls = cn(INPUT_BASE,
    small ? 'min-h-16 py-3 px-5 text-sm' : 'min-h-20 py-4 px-6',
    type === 'password' && showToggle && 'pr-24',
    error && 'border-error focus:border-error',
    mono && 'font-mono text-xs',
    center && 'text-center',
    className);

  const input = (
    <div className="relative w-full min-w-0">
      <input type={effectiveType} className={cls} {...rest} style={{ ...rest.style, ...(actions.length ? { paddingRight: actions.length * 36 + 12 + (showToggle ? 48 : 0) } : {}) }} id={inputId}
        aria-invalid={error ? true : rest['aria-invalid']}
        aria-describedby={[rest['aria-describedby'], error ? errorId : null].filter(Boolean).join(' ') || undefined} />
      {type === 'password' && showToggle && (
        <button
          type="button"
          disabled={rest.disabled}
          aria-pressed={visible}
          className="absolute right-4 top-1/2 -translate-y-1/2 bg-transparent border-none text-brand text-xs font-semibold font-[inherit] cursor-pointer py-1 px-3"
          style={actions.length ? { right: actions.length * 36 + 8 } : undefined}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? t('common.hide') : t('common.show')}
        </button>
      )}
      {actions.length > 0 && <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">{actions}</div>}
    </div>
  );

  return (
    <Container gap={2} className="w-full min-w-0">
      {label && <Container variant="row" gap={1}><label htmlFor={inputId} className="text-sm font-semibold text-secondary">{label}</label>{hint && <InfoTooltip text={hint}/>}</Container>}
      {input}
      {error && <div id={errorId} role="alert" className="text-xs text-error">{error}</div>}
    </Container>
  );
}
