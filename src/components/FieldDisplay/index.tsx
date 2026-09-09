import React from 'react';
import { cn } from '@utils/cn.ts';

/**
 * One labelled value: `[label] ............ [value]`.
 *
 * There were four implementations of this row — this component, the wizard's
 * done step, the sub-account summary, and seven rows in the wallet's send
 * dialog — and they disagreed on every detail: the label was muted in one and
 * secondary in another, semibold in one and medium in another, the value was
 * right-aligned in two of the four. None of that was decided; it was copied.
 *
 * The two differences that ARE real are variants:
 *
 * `divided` draws a hairline between rows, for a stack that fills a Card and
 * needs to read as a list rather than a paragraph. `last:border-b-0` means the
 * card's own edge is never doubled.
 *
 * `caps` is the wallet's dense detail block, where the label is a small
 * uppercase marker beside a value that matters more than it does. It is a
 * different relationship between the two halves, not a different size.
 */

interface FieldDisplayProps {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Monospace value — a key, a derivation path, an invoice. */
  mono?: boolean;
  /** Hairline between rows, for a stack inside a Card. */
  divided?: boolean;
  /** Small uppercase label subordinate to its value. */
  caps?: boolean;
  className?: string;
  /** For a value that needs its own treatment — a larger amount, say. */
  valueClassName?: string;
}

export default function FieldDisplay({
  label, value, mono = false, divided = false, caps = false,
  className = '', valueClassName = '',
}: FieldDisplayProps) {
  return (
    <div
      className={cn(
        'flex justify-between items-baseline gap-6 py-3 text-md',
        divided && 'border-b border-card last:border-b-0',
        className,
      )}
    >
      <span
        className={cn(
          'shrink-0 whitespace-nowrap font-semibold',
          caps ? 'text-xs text-muted uppercase tracking-[0.3px]' : 'text-secondary',
        )}
      >
        {label}
      </span>
      <span className={cn('text-heading text-right break-all min-w-0', mono && 'font-mono text-xs', valueClassName)}>
        {value}
      </span>
    </div>
  );
}
