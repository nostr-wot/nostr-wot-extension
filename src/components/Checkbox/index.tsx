import type { InputHTMLAttributes } from 'react';
import { cn } from '@utils/cn';

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Keep the selection visible on a filled brand row. */
  inverse?: boolean;
};

/** Shared 22px selection control with a 32px target and native keyboard/label behavior. */
export default function Checkbox({ inverse = false, className, ...props }: CheckboxProps) {
  return <span className="relative inline-flex size-16 shrink-0 align-middle items-center justify-center">
    <input {...props} type="checkbox" className={cn('peer absolute inset-0 size-full m-0 opacity-0 cursor-pointer disabled:cursor-not-allowed', className)} />
    <span aria-hidden="true" className={cn(
      'pointer-events-none size-11 box-border rounded-sm border-2 transition-colors peer-disabled:opacity-40 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
      inverse
        ? 'border-on-brand/70 peer-checked:bg-on-brand peer-checked:border-on-brand peer-focus-visible:outline-on-brand'
        : 'border-control-border bg-card peer-hover:border-brand peer-checked:bg-brand peer-checked:border-brand peer-focus-visible:outline-control-focus',
    )} />
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={cn('pointer-events-none absolute size-8 opacity-0 peer-checked:opacity-100 peer-checked:peer-disabled:opacity-40', inverse ? 'text-brand' : 'text-on-brand')}>
      <path d="m5 12 4 4 10-10" />
    </svg>
  </span>;
}
