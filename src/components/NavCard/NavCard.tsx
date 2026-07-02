import React from 'react';
import Card from '@components/Card/Card';
import InfoTooltip from '@components/InfoTooltip/InfoTooltip';
import { IconChevronRight } from '@assets';
import styles from './NavCard.module.css';

interface NavCardProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  info?: string;
  subtitle: React.ReactNode;
  onClick?: () => void;
  trailing?: React.ReactNode;
  className?: string;
}

/**
 * Shared home-screen navigation row card:
 *   [optional icon] [strong title (+ optional InfoTooltip) / subtitle span] [trailing chevron]
 *
 * Consolidates the identical `.blocksCard` markup used by MutesCard and
 * RelaysCard. `title` is rendered in a <strong>, `subtitle` in a <span>,
 * matching the previous inline markup exactly.
 */
export default function NavCard({
  icon,
  title,
  info,
  subtitle,
  onClick,
  trailing = <IconChevronRight size={16} />,
  className = '',
}: NavCardProps) {
  // Apply the icon class to the icon element itself (matching the previous
  // `<IconShield className={styles.blocksIcon} />` markup — no wrapper span).
  const iconEl = React.isValidElement(icon)
    ? React.cloneElement(icon as React.ReactElement<{ className?: string }>, { className: styles.icon })
    : icon;

  return (
    <Card className={`${styles.navCard} ${className}`.trim()} onClick={onClick}>
      {iconEl}
      <div className={styles.text}>
        <strong>
          {title}
          {info && <InfoTooltip text={info} />}
        </strong>
        <span>{subtitle}</span>
      </div>
      {trailing}
    </Card>
  );
}
