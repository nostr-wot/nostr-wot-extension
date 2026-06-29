import React from 'react';
import { IconInfo } from '@assets';
import styles from './InfoTooltip.module.css';

interface InfoTooltipProps {
  text: string;
  size?: number;
}

/**
 * Small "(i)" icon that reveals an explanatory bubble on hover or keyboard
 * focus. Reusable across the popup wherever a control needs a short "what is
 * this?" hint.
 */
export default function InfoTooltip({ text, size = 13 }: InfoTooltipProps) {
  return (
    <span className={styles.wrap} tabIndex={0} role="note" aria-label={text}>
      <IconInfo size={size} />
      <span className={styles.bubble}>{text}</span>
    </span>
  );
}
