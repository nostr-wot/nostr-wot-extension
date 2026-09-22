import React from 'react';
import InfoTooltip from '@components/InfoTooltip';
import IconChevronRight from '@assets/IconChevronRight.tsx';
import { cn } from '@utils/cn.ts';

/**
 * A clickable row in a list: [leading] [title / subtitle] [trailing chevron].
 *
 * This one control had three hand-rolled implementations — NavRow, NavItem and
 * the permissions screen's own `.permRow` — which is why the chevron was brand
 * coloured in two of them and muted in the third, and why only one of the three
 * ellipsised a long subtitle. They differ in chrome, not in structure, so the
 * chrome is a variant and the structure is shared.
 *
 * `grouped` is a bare row that expects a bordered container (a Card, or the
 * permissions list) to own the border and radius; siblings are separated by a
 * hairline. `standalone` carries its own card chrome and is meant to stand on
 * its own with space around it.
 *
 * Not everything that looks vaguely row-shaped belongs here. The account rows in the top-bar
 * dropdown carry their own hover-revealed edit/copy/remove buttons, so the row
 * is a container of controls rather than one control. And the follow
 * suggestions in the wizard are a multi-SELECT list with a checkmark, which is
 * a different control from a row that navigates — it stays hand-rolled until
 * there is a second one, because a variant with a single caller is a guess
 * about what the second one will need.
 */

interface ListRowProps {
  variant?: 'grouped' | 'standalone';
  /** Icon, letter, avatar — anything identifying the row's subject. */
  leading?: React.ReactNode;
  /** Wrap the leading node in a soft brand-tinted square. */
  leadingChip?: boolean;
  title: React.ReactNode;
  /** Renders a tooltip beside the title. */
  info?: string;
  subtitle?: React.ReactNode;
  /** Defaults to a chevron. Pass `null` for a row that does not navigate. */
  trailing?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
}

const ROW_BASE = 'flex items-center gap-6 w-full font-[inherit] text-left cursor-pointer';

/**
 * `grouped`'s hairline between stacked rows is an adjacent-sibling selector.
 * Tailwind's arbitrary variant expresses the selector directly, but a pair of
 * border-top width/color utilities would not work here: both read the
 * top-side style off the shared `--tw-border-style` custom property, and the
 * `border-none` on this same row (stripping the button's UA border) sets
 * that property to `none` for the whole element -- the hairline would
 * compile but never actually render. The one arbitrary *property* below
 * writes a literal `border-top` declaration, sidestepping that variable
 * entirely, same as the plain CSS it replaces.
 */
const VARIANT: Record<NonNullable<ListRowProps['variant']>, string> = {
  grouped:
    'py-5 px-6 bg-transparent border-none [&+&]:[border-top:1px_solid_var(--brand-tint-active)] ' +
    'transition-colors hover:bg-brand-tint-hover active:bg-card-active',
  standalone:
    'py-8 px-7 border border-card-border bg-glass-heavy rounded-lg shadow-card ' +
    'transition-all hover:bg-hover hover:translate-x-2 hover:shadow-card-hover',
};

export default function ListRow({
  variant = 'grouped',
  leading,
  leadingChip = true,
  title,
  info,
  subtitle,
  trailing = <IconChevronRight size={16} />,
  onClick,
  className = '',
}: ListRowProps) {
  // An icon passed as an element gets the row's leading colour, so callers do
  // not each have to remember which token the chip's contents use.
  const leadingEl = React.isValidElement(leading)
    ? React.cloneElement(leading as React.ReactElement<{ className?: string }>, {
        className: 'text-brand',
      })
    : leading;

  return (
    <button
      type="button"
      className={cn(ROW_BASE, VARIANT[variant], className)}
      onClick={onClick}
    >
      {leading != null && (
        <span
          className={
            leadingChip
              ? 'flex items-center justify-center w-[30px] h-[30px] rounded-md bg-brand-light text-brand text-md font-bold shrink-0'
              : 'flex items-center shrink-0'
          }
        >
          {leadingEl}
        </span>
      )}
      <span className="flex flex-col gap-1 min-w-0 flex-1">
        <span className="inline-flex items-center gap-2 text-md font-semibold text-heading min-w-0">
          {title}
          {info && <InfoTooltip text={info} />}
        </span>
        {subtitle != null && (
          <span className="text-xs text-menu-subtitle overflow-hidden text-ellipsis whitespace-nowrap">{subtitle}</span>
        )}
      </span>
      {trailing != null && <span className="flex items-center text-muted shrink-0">{trailing}</span>}
    </button>
  );
}
