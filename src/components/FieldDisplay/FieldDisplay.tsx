import React from 'react';
import { cn } from '@utils/cn.ts';

interface FieldDisplayProps {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}

export default function FieldDisplay({ label, value, mono = false, className = '' }: FieldDisplayProps) {
  const rootCls = cn('flex justify-between items-baseline py-3 text-md gap-6', className);
  const valCls = cn('text-heading text-right break-all min-w-0',
    mono && 'font-mono text-xs');
  return (
    <div className={rootCls}>
      <span className="text-secondary font-medium whitespace-nowrap shrink-0">{label}</span>
      <span className={valCls}>{value}</span>
    </div>
  );
}
