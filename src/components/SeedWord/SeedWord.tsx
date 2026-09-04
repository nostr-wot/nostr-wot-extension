import React from 'react';
import { cn } from '@utils/cn.ts';

const SEED_WORD = 'flex items-center gap-3 px-4 py-2 text-sm font-medium text-heading';
// A 24-word phrase does not fit the popup at the default size.
const COMPACT = 'gap-2 px-[5px] py-2 text-xs';
// Only when it renders as a button — resets the chrome the UA adds.
const CLICKABLE = 'border-none bg-none font-[inherit] cursor-pointer';
const INDEX = 'min-w-[16px] text-2xs font-semibold text-muted [font-variant-numeric:tabular-nums]';
const INDEX_COMPACT = 'min-w-[13px] text-[9px]';

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
  const cls = `${SEED_WORD} ${compact ? COMPACT : ''} ${className}`;
  const indexCls = `${INDEX} ${compact ? INDEX_COMPACT : ''}`;
  const body = (
    <>
      <span className={indexCls}>{index}</span>
      {word}
    </>
  );
  return onClick ? (
    <button type="button" className={cn(cls, CLICKABLE)} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
