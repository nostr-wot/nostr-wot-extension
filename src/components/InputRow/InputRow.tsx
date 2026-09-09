import React from 'react';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import IconPlus from '@assets/IconPlus.tsx';

interface InputRowProps {
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  onSubmit?: () => void;
  buttonLabel: string;
  add?: boolean;
  disabled?: boolean;
  error?: string;
  mono?: boolean;
  className?: string;
}

export default function InputRow({ value, onChange, placeholder, onSubmit, buttonLabel,
  add = false, disabled = false, error, mono = false, className = '',
}: InputRowProps) {
  const blocked = disabled || !value.trim() || !!error;
  const submit = () => { if (!blocked) onSubmit?.(); };
  return (
    <div className={className}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <Input
            placeholder={placeholder} aria-label={placeholder || buttonLabel}
            value={value} onChange={onChange} error={error}
            onKeyDown={event => {
              if (event.key === 'Enter') { event.preventDefault(); submit(); }
            }}
            mono={mono}
          />
        </div>
        <Button type="button" onClick={submit} disabled={blocked}
          aria-label={buttonLabel} title={buttonLabel}
          className={add ? 'w-20 shrink-0 px-0' : 'shrink-0'}>
          {add ? <IconPlus size={18} aria-hidden="true" /> : buttonLabel}
        </Button>
      </div>
    </div>
  );
}
