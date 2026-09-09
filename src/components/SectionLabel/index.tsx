import React from 'react';
import { cn } from '@utils/cn.ts';

/**
 * The label above a field, and the hint under it.
 *
 * `text-sm font-semibold text-secondary` was written by hand at a dozen call
 * sites, with the spacing below it varying between nothing, `mb-1` and `mb-3`
 * for no reason anyone decided — the same label, three heights apart,
 * depending on which screen it was copied from.
 *
 * `block` is the default because a label above its field is the common case;
 * pass `inline` for the handful that sit on a row beside their value.
 *
 * It renders a real `<label>`, so **give it `htmlFor`** whenever there is an
 * input to point at: that is what lets the label be clicked to focus the field
 * and what a screen reader reads when the field takes focus. Several of the
 * call sites this replaced had no association at all.
 */

interface SectionLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Sits on a row beside its value rather than above it. */
  inline?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function SectionLabel({ inline = false, children, className = '', ...rest }: SectionLabelProps) {
  return (
    <label
      className={cn('text-sm font-semibold text-secondary', inline ? 'inline' : 'block mb-3', className)}
      {...rest}
    >
      {children}
    </label>
  );
}

interface SectionHintProps {
  children?: React.ReactNode;
  className?: string;
}

/** The explanatory line under a label — never the place for an error. */
export function SectionHint({ children, className = '' }: SectionHintProps) {
  return (
    <div className={cn('text-xs text-muted leading-normal mb-2', className)}>
      {children}
    </div>
  );
}
