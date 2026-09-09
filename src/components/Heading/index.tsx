import React from 'react';
import { cn } from '@utils/cn.ts';

/**
 * A heading, at one of the five sizes this product actually uses.
 *
 * `text-3xl font-bold text-heading` was written out at fourteen call sites —
 * every wizard step title — and four more sizes existed alongside it with no
 * name. Nothing said which was which, so a new screen picked whichever one it
 * was copied from.
 *
 * The level picks the size *and* the element, because those should not drift
 * apart: a title that renders as a `<span>` is invisible to anything
 * navigating by heading, which is how the wizard's own step title was written.
 * Pass `as` only when the outline genuinely needs a different rank from the
 * size — a small heading high in the document, or a large one nested deep.
 */

interface HeadingProps {
  /** 1 is the page title; 5 is a heading inside a card or callout. */
  level?: 1 | 2 | 3 | 4 | 5;
  /** Override the element without changing the size. */
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  children: React.ReactNode;
  className?: string;
}

const SIZE: Record<number, string> = {
  1: 'text-display font-heavy',
  2: 'text-3xl font-bold',
  3: 'text-2xl font-bold',
  4: 'text-xl font-bold',
  5: 'text-md font-bold',
};

export default function Heading({ level = 2, as, children, className = '' }: HeadingProps) {
  const Tag = (as ?? (`h${level}` as const)) as React.ElementType;
  return <Tag className={cn('text-heading', SIZE[level], className)}>{children}</Tag>;
}
