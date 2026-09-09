import React from 'react';
import { cn } from '@utils/cn.ts';

// One size, chosen: text-sm. The copies were split between sm and xs with no
// pattern, and the smaller one was being used for the message explaining why
// a key export just failed. Spacing is the surrounding form's business.
const ERROR = 'text-sm leading-normal text-error';

/**
 * The line a form shows when it could not do what was asked.
 *
 * There were twenty-six of these across twenty-one files, each with its own
 * `.error` rule — the same two declarations, at two different font sizes,
 * because nobody chose either. Some carried a top margin and some did not.
 *
 * The part worth having a component for is `role="alert"`. Exactly one of the
 * twenty-six had it. Everywhere else an error appearing in response to a failed
 * submit was never announced: a screen-reader user pressed the button, nothing
 * was read out, and the only signal that anything had happened was on screen.
 * That one is `ConfirmDialog` — worth knowing, because it means the fix was
 * already understood here and simply not carried anywhere else.
 *
 * Renders nothing for an empty message, so callers stop writing the
 * `{error && ...}` guard — which is also how one of them came to render an
 * empty red box for a falsy-but-present value.
 */

interface FormErrorProps {
  children?: React.ReactNode;
  className?: string;
}

export default function FormError({ children, className = '' }: FormErrorProps) {
  if (!children) return null;
  return (
    <div className={cn(ERROR, className)} role="alert">
      {children}
    </div>
  );
}
