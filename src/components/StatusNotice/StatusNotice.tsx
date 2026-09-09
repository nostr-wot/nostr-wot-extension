import React from 'react';
import InfoTooltip from '@components/InfoTooltip/InfoTooltip';
import { cn } from '@utils/cn.ts';

// [&+&]:mt-4 — the adjacent-sibling gap between a status and its caveat.
// cn() merges this with a caller's own margin-top utility as one group.
const NOTICE = 'flex items-center gap-4 py-5 px-6 rounded-panel text-md [&+&]:mt-4';

type Tone = 'ok' | 'warn' | 'error';

/**
 * `ok`'s tint is a one-off literal (`rgba(22, 163, 74, 0.08)`) that appears
 * nowhere else, so it stays an arbitrary value rather than snapping to
 * `--success-tint` (a different green, a different alpha) and quietly
 * changing what this renders. `warn` uses `--warning-tint-heavy`, the
 * genuinely-shared `rgba(217, 119, 6, 0.1)` also used by EventPreview and
 * PromptApp (see theme.css).
 */
const TONE: Record<Tone, string> = {
  ok: 'bg-[rgba(22,163,74,0.08)] text-success-strong',
  warn: 'bg-warning-tint-heavy text-warning-strong',
  error: 'bg-error-tint text-error',
};

interface StatusNoticeProps {
  tone: Tone;
  icon: React.ReactNode;
  label?: string;
  variant?: 'status' | 'callout';
  className?: string;
  /** Detail, shown on hover or keyboard focus rather than taking a paragraph. */
  info?: string;
  children?: React.ReactNode;
}

/**
 * A compact status row, or a top-aligned callout with a wrapping paragraph.
 * Both share spacing and corners; callouts keep their explanation visible.
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
export default function StatusNotice({ tone, icon, label, info, children, variant = 'status', className }: StatusNoticeProps) {
  const callout = variant === 'callout';
  return (
    <div className={cn(
      NOTICE, TONE[tone],
      callout && 'items-start text-sm leading-normal',
      className,
    )}>
      <span aria-hidden="true" className={cn('flex items-center shrink-0', callout && 'mt-px')}>{icon}</span>
      {callout ? (
        <div className="min-w-0 flex-1 break-words">
          {label && <strong className="block text-md font-semibold leading-normal mb-1">{label}</strong>}
          {children}
          {info && <InfoTooltip text={info} />}
        </div>
      ) : (
        <>
          {label && <strong className="min-w-0 font-semibold leading-[1.35]">{label}</strong>}
          {info && <InfoTooltip text={info} />}
          {children}
        </>
      )}
    </div>
  );
}
