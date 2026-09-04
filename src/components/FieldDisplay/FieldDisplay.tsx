import React from 'react';

interface FieldDisplayProps {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}

export default function FieldDisplay({ label, value, mono = false, className = '' }: FieldDisplayProps) {
  const rootCls = ['flex justify-between items-baseline py-3 text-md gap-6', className].filter(Boolean).join(' ');
  const valCls = [
    'text-heading text-right break-all min-w-0',
    mono && 'font-mono text-xs',
  ].filter(Boolean).join(' ');
  return (
    <div className={rootCls}>
      <span className="text-secondary font-medium whitespace-nowrap shrink-0">{label}</span>
      <span className={valCls}>{value}</span>
    </div>
  );
}
