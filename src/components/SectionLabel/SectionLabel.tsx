import React from 'react';
import { cn } from '@utils/cn.ts';

interface SectionLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  children?: React.ReactNode;
  className?: string;
}

export function SectionLabel({ children, className = '', ...rest }: SectionLabelProps) {
  return (
    <label className={cn('text-sm font-semibold text-secondary mb-1', className)} {...rest}>
      {children}
    </label>
  );
}

interface SectionHintProps {
  children?: React.ReactNode;
  className?: string;
}

export function SectionHint({ children, className = '' }: SectionHintProps) {
  return (
    <div className={cn('text-xs text-muted leading-normal mb-2', className)}>
      {children}
    </div>
  );
}
