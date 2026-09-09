import { useState } from 'react';
import { t } from '@services/i18n/i18n.ts';
import Button from '@components/Button/Button';
import Select from '@components/Select/Select';
import Container from '@components/Container/Container';
import type { PromptDecision } from '@domain/permissions/prompt.ts';

interface DecisionRowProps {
  disabled: boolean;
  onDecision: (decision: PromptDecision) => void;
}

/** Prompt-specific permission choices composed from shared controls. */
export default function DecisionRow({ disabled, onDecision }: DecisionRowProps) {
  const [duration, setDuration] = useState('3600000');
  return (
    <Container gap={3}>
      <Container variant="row" gap={3} className="flex-wrap">
        <Button type="button" variant="danger" disabled={disabled}
          onClick={() => onDecision({ allow: false, remember: false })}>
          {t('prompt.deny')}
        </Button>
        <Button type="button" variant="secondary" disabled={disabled}
          onClick={() => onDecision({ allow: true, remember: false })}>
          {t('prompt.once')}
        </Button>
        <Button type="button" disabled={disabled}
          onClick={() => onDecision({ allow: true, remember: true, duration: 0 })}>
          {t('prompt.always')}
        </Button>
      </Container>
      <Container variant="row" gap={3}>
        <Button type="button" variant="secondary" disabled={disabled}
          onClick={() => onDecision({ allow: true, remember: true, duration: Number(duration) })}>
          {t('prompt.session')}
        </Button>
        <Select
          aria-label={t('prompt.session')}
          disabled={disabled}
          options={[
            { value: '3600000', label: t('prompt.1h') },
            { value: '86400000', label: t('prompt.24h') },
            { value: '604800000', label: t('prompt.7d') },
            { value: '0', label: t('prompt.forever') },
          ]}
          value={duration}
          onChange={e => setDuration(e.target.value)}
        />
      </Container>
    </Container>
  );
}
