import React from 'react';
import styles from './SeedWord.module.css';

interface SeedWordProps {
  /** 1-based position in the phrase. */
  index: number;
  word: string;
  className?: string;
}

/** One numbered word of a recovery phrase. */
export default function SeedWord({ index, word, className = '' }: SeedWordProps) {
  return (
    <div className={`${styles.seedWord} ${className}`}>
      <span className={styles.index}>{index}</span>
      {word}
    </div>
  );
}
