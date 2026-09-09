import React from 'react';
import { cn } from '@utils/cn.ts';

/**
 * Body copy, at one of the four roles this product actually uses.
 *
 * `text-md text-secondary leading-normal` was written out by hand at fifteen
 * call sites — every wizard step's intro paragraph — and dozens more
 * one-line `<p>`/`<span>` combinations of a colour, a size and a leading
 * existed alongside it with no name, each screen picking whichever
 * combination it was copied from.
 *
 * `body` is the default: plain paragraph text. `secondary` is the
 * de-emphasised copy under a heading or a control. `muted` is a caption or
 * metadata line — it was the single most common combination in the tree
 * (`text-xs text-muted`, 25 sites). `hint` is small explanatory text read as
 * a sentence rather than scanned as a label, so it keeps `leading-loose`
 * where `muted` does not — that loose leading is the one real difference;
 * everything else about the two is identical, which is why they share a
 * colour and size instead of being four unrelated declarations.
 *
 * There is deliberately no `size` prop. A handful of call sites want
 * `secondary` at `text-sm` instead of the default `text-md` — pass it
 * through `className`, which wins over the variant's own size the same way
 * every other override in this codebase does. Naming a fifth variant for
 * that would be guessing at a distinction nobody actually drew.
 *
 * `as` picks the element, because a paragraph and an inline span are not
 * interchangeable even when they render identically — both exist throughout
 * this codebase for that reason, and neither can stand in for the other.
 */

interface TextProps extends React.HTMLAttributes<HTMLElement> {
  variant?: 'body' | 'secondary' | 'muted' | 'hint';
  /** Monospace — a key, an invoice, a pubkey fragment. */
  mono?: boolean;
  as?: 'p' | 'span' | 'div' | 'strong' | 'li' | 'label';
  children?: React.ReactNode;
  className?: string;
}

const VARIANT: Record<NonNullable<TextProps['variant']>, string> = {
  body: 'text-md text-body leading-normal',
  secondary: 'text-md text-secondary leading-normal',
  muted: 'text-xs text-muted leading-normal',
  hint: 'text-xs text-muted leading-loose',
};

export default function Text({
  variant = 'body', mono = false, as = 'p', children, className = '', ...rest
}: TextProps) {
  const Tag = as as React.ElementType;
  return (
    <Tag className={cn(VARIANT[variant], mono && 'font-mono', className)} {...rest}>
      {children}
    </Tag>
  );
}
