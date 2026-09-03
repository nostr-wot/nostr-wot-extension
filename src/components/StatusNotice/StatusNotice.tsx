import React from 'react';
import InfoTooltip from '@components/InfoTooltip/InfoTooltip';
import styles from './StatusNotice.module.css';

type Tone = 'ok' | 'warn';

interface StatusNoticeProps {
  tone: Tone;
  icon: React.ReactNode;
  label: string;
  /** Detail, shown on hover or keyboard focus rather than taking a paragraph. */
  info?: string;
  children?: React.ReactNode;
}

/**
 * A one-line status row: an icon, a short label, and the long version behind an
 * (i).
 *
 * One component with a tone rather than two similar blocks, because the pair
 * appears together — a green "here is what you have" above a yellow "here is
 * what that costs you" — and when they were styled separately they disagreed
 * about padding, icon size and text weight, which read as two unrelated things
 * rather than one status and its caveat.
 *
 * The tone carries meaning on its own. Someone who never hovers should still be
 * able to tell a state from a warning, so the colour is not decoration.
 */
export default function StatusNotice({ tone, icon, label, info, children }: StatusNoticeProps) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`}>
      <span className={styles.icon}>{icon}</span>
      <strong className={styles.label}>{label}</strong>
      {info && <InfoTooltip text={info} />}
      {children}
    </div>
  );
}
