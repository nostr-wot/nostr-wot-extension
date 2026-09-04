import React from 'react';
import InfoTooltip from '@components/InfoTooltip/InfoTooltip';
import { IconChevronRight } from '@assets';
import styles from './ListRow.module.css';

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
 * Not everything that looks vaguely row-shaped belongs here: the language
 * trigger in the menu footer is an auto-width pill with a chevron-DOWN, which
 * is a dropdown trigger rather than a list row. Widening this component to
 * cover it would mean it no longer describes anything.
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
        className: styles.leadingIcon,
      })
    : leading;

  return (
    <button
      type="button"
      className={`${styles.row} ${styles[variant]} ${className}`}
      onClick={onClick}
    >
      {leading != null && (
        <span className={leadingChip ? styles.leadingChip : styles.leadingBare}>{leadingEl}</span>
      )}
      <span className={styles.text}>
        <span className={styles.title}>
          {title}
          {info && <InfoTooltip text={info} />}
        </span>
        {subtitle != null && <span className={styles.subtitle}>{subtitle}</span>}
      </span>
      {trailing != null && <span className={styles.trailing}>{trailing}</span>}
    </button>
  );
}
