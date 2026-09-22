import React from 'react';
import { cn } from '@utils/cn.ts';

/**
 * A small selectable pill.
 *
 * `aria-pressed` rather than plain button semantics: a chip is a toggle showing
 * its own state, and without it a screen reader reads only the label and gives
 * no way to tell which one is active.
 */

interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  /**
   * Colour for a chip whose meaning is the colour — a permission decision.
   * `neutral` marks selection only.
   */
  tone?: 'neutral' | 'allow' | 'deny' | 'ask';
  /**
   * Whether this chip is a toggle that reports its own on/off state.
   *
   * True for a filter or a permission decision. False for a chip that is a
   * one-shot action — the recovery-phrase word bank, where tapping a word
   * consumes it — because `aria-pressed="false"` on those announces every
   * available word as "not pressed", which describes a toggle nobody offered.
   */
  toggle?: boolean;
  children: React.ReactNode;
}

// `font-[inherit]` is not decoration: preflight is off, so a <button> still
// gets the UA's own font family and would otherwise not match its own label.
const BASE =
  'px-5 py-2 border rounded-sm bg-transparent font-[inherit] text-xs font-semibold ' +
  'cursor-pointer transition-all disabled:opacity-50 disabled:cursor-default';

const UNSELECTED = 'border-card-border text-secondary hover:bg-hover';

/** Toned selections, where the colour carries the meaning rather than just
 *  marking which one is on: allow is not merely "selected", it is allow. */
const TONES: Record<string, string> = {
  neutral: 'border-brand bg-brand-tint-active text-brand',
  allow: 'border-success-tint bg-success-tint text-success',
  deny: 'border-error-tint bg-error-tint text-error',
  ask: 'border-warning-tint bg-warning-tint text-warning',
};

export default function Chip({
  selected = false, tone = 'neutral', toggle = true, className = '', children, ...rest
}: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={toggle ? selected : undefined}
      className={cn(BASE, selected ? TONES[tone] : UNSELECTED, className)}
      {...rest}
    >
      {children}
    </button>
  );
}
