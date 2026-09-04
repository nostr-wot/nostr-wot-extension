import React from 'react';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import Container from '@components/Container/Container';

interface InputRowProps {
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  onSubmit?: () => void;
  buttonLabel: string;
  disabled?: boolean;
  error?: string;
  mono?: boolean;
  className?: string;
}

export default function InputRow({
  value,
  onChange,
  placeholder,
  onSubmit,
  buttonLabel,
  disabled = false,
  error,
  mono = false,
  className = '',
}: InputRowProps) {
  return (
    <div className={className}>
      <Container variant="row" gap={4}>
        <Input
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && onSubmit?.()}
          mono={mono}
        />
        <Button small onClick={onSubmit} disabled={disabled}>{buttonLabel}</Button>
      </Container>
      {error && <div className="text-error text-xs mt-2">{error}</div>}
    </div>
  );
}
