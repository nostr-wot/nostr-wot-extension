import React from 'react';
import { cn } from '@utils/cn.ts';

/**
 * A layout box, at one of the three shapes this product actually uses.
 *
 * `flex flex-col gap-N` was written out ad hoc at dozens of sites with N
 * chosen freely, `flex items-center gap-4` did the same for a row, and the
 * card-like inline box — `bg-card border border-card-border rounded-panel`,
 * padded and gapped — was retyped identically at both the wallet's send
 * dialog and the permissions screen's selected-rule row. That box is
 * deliberately not `Card`: the padding (`py-5 px-6` vs `p-7`), radius
 * (`rounded-panel` vs `rounded-lg`) and margin (none vs `mb-6`) all differ
 * from it, so reaching for `Card` there would have changed how each one
 * looks.
 *
 * `column` and `row` are bare flex containers; `gap` is the only thing they
 * own. Alignment, wrapping, `flex-1`, `overflow-y-auto` and margin are all
 * additive and stay in `className` — none of them conflicts with what this
 * component sets, so there is nothing for a variant to decide.
 *
 * `row` defaults to `items-center`, matching every row that carried it by
 * hand; the handful of button rows that did not still line up identically
 * under it, because same-height buttons render the same stretched or
 * centered — a converged default, not a visible change.
 *
 * `box` is the padded card-like shape. Its own `gap` defaults to 3, matching
 * every site that used it before this existed; pass a different one for the
 * real exception — the permissions screen's selected-rule box uses `gap={1}`
 * and overrides the border colour and margin through `className`.
 *
 * `stickyFooter` is the wizard step's own action bar: pinned under
 * `mt-auto`, sitting above its own opaque background so scrolled content
 * does not show through it. It was retyped, character for character, at the
 * bottom of every one of the ten wizard steps.
 */

type Gap = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 'px';
type Variant = 'column' | 'row' | 'box';

interface ContainerProps extends React.HTMLAttributes<HTMLElement> {
  variant?: Variant;
  gap?: Gap;
  /** The wizard step's pinned action row — see above. */
  stickyFooter?: boolean;
  as?: React.ElementType;
  className?: string;
  children?: React.ReactNode;
}

const GAP: Record<Gap, string> = {
  1: 'gap-1', 2: 'gap-2', 3: 'gap-3', 4: 'gap-4', 5: 'gap-5', 6: 'gap-6', 7: 'gap-7', px: 'gap-px',
};

const VARIANT_BASE: Record<Variant, string> = {
  column: 'flex flex-col',
  row: 'flex items-center',
  box: 'flex flex-col py-5 px-6 bg-card border border-card-border rounded-panel',
};

const DEFAULT_GAP: Partial<Record<Variant, Gap>> = {
  box: 3,
};

// The wizard step body's own footer bar. `both` fill-mode is deliberately
// absent — see docs/component-standards.md §7 on why a lingering transform or
// non-static positioning here would turn every fixed descendant into one
// positioned against this bar instead of the popup.
const STICKY_FOOTER = 'mt-auto py-8 sticky bottom-0 z-[1] [background:var(--bg-page)]';

export default function Container({
  variant = 'column', gap, stickyFooter = false, as = 'div', className = '', children, ...rest
}: ContainerProps) {
  const Tag = as;
  const resolvedGap = gap ?? DEFAULT_GAP[variant];
  return (
    <Tag
      className={cn(
        VARIANT_BASE[variant],
        resolvedGap !== undefined && GAP[resolvedGap],
        stickyFooter && STICKY_FOOTER,
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
