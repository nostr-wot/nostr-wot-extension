import React from 'react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  text?: string;
  hint?: string;
  children?: React.ReactNode;
  className?: string;
}

export default function EmptyState({ icon, text, hint, children, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center text-center px-10 py-14 gap-4 ${className}`}>
      {icon && <div className="text-brand mb-2">{icon}</div>}
      {text && <div className="text-lg font-medium text-body">{text}</div>}
      {hint && <div className="text-sm text-muted leading-normal">{hint}</div>}
      {children}
    </div>
  );
}
