import React from 'react';
import InfoTooltip from '@components/InfoTooltip/InfoTooltip';
import { IconChevronRight } from '@assets';
import styles from './NavRow.module.css';

interface NavRowProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  info?: string;
  subtitle?: React.ReactNode;
  onClick?: () => void;
  trailing?: React.ReactNode;
}

/**
 * A single navigation row meant to sit inside a grouped card alongside sibling
 * rows: [icon chip] [title (+optional info) / subtitle] [trailing chevron].
 * Adjacent rows are separated by a hairline (`.row + .row`), so a stack of
 * NavRows inside one Card reads as one cohesive list.
 */
export default function NavRow({
  icon,
  title,
  info,
  subtitle,
  onClick,
  trailing = <IconChevronRight size={16} />,
}: NavRowProps) {
  const iconEl = React.isValidElement(icon)
    ? React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: styles.icon })
    : icon;

  return (
    <button type="button" className={styles.row} onClick={onClick}>
      {iconEl && <span className={styles.iconChip}>{iconEl}</span>}
      <span className={styles.text}>
        <span className={styles.title}>
          {title}
          {info && <InfoTooltip text={info} />}
        </span>
        {subtitle != null && <span className={styles.subtitle}>{subtitle}</span>}
      </span>
      <span className={styles.chevron}>{trailing}</span>
    </button>
  );
}
