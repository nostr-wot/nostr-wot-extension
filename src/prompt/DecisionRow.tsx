import React, { useState, ChangeEvent } from 'react';
import { t } from '@lib/i18n.js';
import Select from '@components/Select/Select';
import type { PromptDecision } from '@domain/permissions/prompt.ts';

interface DecisionRowProps {
  disabled: boolean;
  onDecision: (decision: PromptDecision) => void;
}

// Shared by every decision button: only the tone (background/border/text) and
// corner rounding differ per button. Rounding is deliberately NOT here —
// the allow-session button below overrides all four corners with an
// arbitrary border-radius shorthand, and mixing that with a plain `rounded-md`
// on the same element would leave the two fighting over generation order.
const DECISION_BTN =
  'py-5 px-8 border text-md font-semibold cursor-pointer transition-all ' +
  'hover:-translate-y-px active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed';

export default function DecisionRow({ disabled, onDecision }: DecisionRowProps) {
  const [duration, setDuration] = useState<string>('3600000'); // 1 hour default

  return (
    <div className="flex gap-3 items-center flex-wrap">
      <button
        className={`${DECISION_BTN} rounded-md bg-[rgba(220,38,38,0.1)] border-[rgba(220,38,38,0.15)] text-error`}
        disabled={disabled}
        onClick={() => onDecision({ allow: false, remember: false })}
      >
        {t('prompt.deny')}
      </button>
      <button
        className={`${DECISION_BTN} rounded-md bg-[rgba(37,99,235,0.1)] border-[rgba(37,99,235,0.15)] text-info`}
        disabled={disabled}
        onClick={() => onDecision({ allow: true, remember: false })}
      >
        {t('prompt.once')}
      </button>
      <button
        // Structurally joined to the duration <Select> below: right corners
        // squared off here, left corners (and the shared border) squared off
        // there, so the pair reads as one pill. Kept as an arbitrary value
        // rather than composed rounded-* utilities — the two would need to
        // land in a specific generation order to override each other's
        // corners, which is fragile to depend on.
        className={`${DECISION_BTN} bg-brand-light text-brand border-[rgba(99,102,241,0.15)] rounded-[var(--radius-sm)_0_0_var(--radius-sm)]`}
        disabled={disabled}
        onClick={() => onDecision({ allow: true, remember: true, duration: parseInt(duration) })}
      >
        {t('prompt.session')}
      </button>
      <Select
        small
        className="text-xs py-5 px-2 bg-brand-light border border-l-0 border-[rgba(99,102,241,0.15)] rounded-[0_var(--radius-sm)_var(--radius-sm)_0] text-brand cursor-pointer"
        options={[
          { value: '3600000', label: t('prompt.1h') },
          { value: '86400000', label: t('prompt.24h') },
          { value: '604800000', label: t('prompt.7d') },
          { value: '0', label: t('prompt.forever') },
        ]}
        value={duration}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => setDuration(e.target.value)}
      />
      <button
        className={`${DECISION_BTN} rounded-md bg-[rgba(5,150,105,0.1)] border-[rgba(5,150,105,0.15)] text-success`}
        disabled={disabled}
        onClick={() => onDecision({ allow: true, remember: true, duration: 0 })}
      >
        {t('prompt.always')}
      </button>
    </div>
  );
}
