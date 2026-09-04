import React from 'react';
import styles from './SeedWord.module.css';

interface SeedWordProps {
  /** 1-based position in the phrase. */
  index: number;
  word: string;
  /**
   * Makes the word interactive — the verify step lets you take a placed word
   * back out of its slot. When set it renders a real button, because the
   * div-with-onClick it replaced could not be reached from the keyboard.
   */
  onClick?: () => void;
  /**
   * Tighter spacing for a 24-word phrase, which does not otherwise fit the
   * popup's width. The wizard used to do this from the grid's stylesheet with
   * a descendant selector; that stopped reaching once the word became a
   * component with its own scoped classes.
   */
  compact?: boolean;
  className?: string;
}

/** One numbered word of a recovery phrase. */
export default function SeedWord({ index, word, onClick, compact = false, className = '' }: SeedWordProps) {
  const cls = `${styles.seedWord} ${compact ? styles.compact : ''} ${className}`;
  const body = (
    <>
      <span className={styles.index}>{index}</span>
      {word}
    </>
  );
  return onClick ? (
    <button type="button" className={`${cls} ${styles.clickable}`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
