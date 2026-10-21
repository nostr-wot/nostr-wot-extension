import { useEffect, useRef, useState } from 'react';
import { t } from '@services/i18n/i18n.ts';
import {
  PHYSICAL_ENTROPY_FACES, PHYSICAL_ENTROPY_REQUIRED, isPhysicalResult, physicalEntropyBits,
  type PhysicalEntropyKind,
} from '@domain/accounts/physicalEntropy.ts';
import { GENERATED_MNEMONIC_STRENGTH_BITS } from '@constants/accounts.ts';
import IconWarning from '@assets/IconWarning.tsx';
import Button, { ButtonSecondary } from '@components/Button';
import Container from '@components/Container';
import ScreenReaderStatus from '@components/ScreenReaderStatus';
import StatusNotice from '@components/StatusNotice';
import Tabs from '@components/Tabs';
import Text from '@components/Text';
import { cn } from '@utils/cn.ts';
import { Coin, Die, DieFace } from './EntropyArt';

interface EntropyGameProps {
  /** Called with the complete list of results; resolve false to keep them for a retry. */
  onComplete: (kind: PhysicalEntropyKind, results: number[]) => Promise<boolean>;
}

/**
 * Record real coin flips or dice rolls, one at a time, until they cover a
 * 256-bit seed. Every new result tosses the coin or rolls the die on screen.
 *
 * Results live in memory only. They are the seed itself (coin flips verbatim),
 * so they are never written to storage; closing the tab with results recorded
 * asks first instead.
 */
export default function EntropyGame({ onComplete }: EntropyGameProps) {
  const [kind, setKind] = useState<PhysicalEntropyKind>('dice');
  const [results, setResults] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const unsaved = results.length > 0;
  useEffect(() => {
    if (!unsaved) return;
    // returnValue as well: Safari and older Chrome ignore preventDefault alone.
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const required = PHYSICAL_ENTROPY_REQUIRED[kind];
  const complete = results.length >= required;
  const last = results.length ? results[results.length - 1] : null;
  const bits = physicalEntropyBits(kind, results.length);
  const locked = busy;

  const record = (value: number) => {
    if (locked || !isPhysicalResult(kind, value)) return;
    setResults((prev) => (prev.length < required ? [...prev, value] : prev));
  };
  const undo = () => { if (!locked) setResults((prev) => prev.slice(0, -1)); };

  // Digit keys record a result, so a long session can be typed without the mouse.
  // The latest handlers are read through a ref, so the listener is added once.
  const keys = useRef({ record, undo });
  keys.current = { record, undo };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Typing into a field is not a roll.
      const target = event.target as Partial<Element> | null;
      if (typeof target?.closest === 'function' && target.closest('input, textarea, [contenteditable="true"]')) return;
      if (event.key === 'Backspace') keys.current.undo();
      else if (/^\d$/.test(event.key)) keys.current.record(Number(event.key));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const accept = async () => {
    if (!complete || locked) return;
    setBusy(true);
    try {
      if (await onComplete(kind, results)) setResults([]);
    } finally {
      setBusy(false);
    }
  };

  const faceLabel = (value: number) => (kind === 'coin'
    ? t(value === 1 ? 'entropyGame.heads' : 'entropyGame.tails')
    : String(value));

  return (
    <Container gap={5}>
      <Tabs<PhysicalEntropyKind>
        variant="segmented"
        label={t('entropyGame.sourceLabel')}
        value={kind}
        disabled={locked || results.length > 0}
        onChange={(next) => { setKind(next); setResults([]); }}
        options={[
          { value: 'dice', label: t('entropyGame.dice') },
          { value: 'coin', label: t('entropyGame.coin') },
        ]}
      />

      <div className="flex items-center gap-6">
        {/* Keyed by count so every recorded result replays the toss. */}
        <div className="shrink-0 [perspective:400px]" key={results.length}>
          <div className={cn('origin-center', results.length > 0 && (kind === 'coin' ? 'animate-coin-flip' : 'animate-die-roll'))}>
            {kind === 'coin' ? <Coin value={last} /> : <Die value={last} />}
          </div>
        </div>
        <Container gap={2} className="flex-1 min-w-0">
          <Text as="div" className="text-md font-semibold text-heading">
            {t(kind === 'coin' ? 'entropyGame.flipCount' : 'entropyGame.rollCount', { count: String(results.length), total: String(required) })}
          </Text>
          <div
            className="h-4 rounded-full bg-card-border overflow-hidden"
            role="progressbar"
            aria-label={t('entropyGame.progressLabel')}
            aria-valuemin={0}
            aria-valuemax={GENERATED_MNEMONIC_STRENGTH_BITS}
            aria-valuenow={bits}
          >
            <div className={cn('h-full rounded-full transition-[width] duration-300', complete ? 'bg-success' : 'bg-brand')} style={{ width: `${(bits / GENERATED_MNEMONIC_STRENGTH_BITS) * 100}%` }} />
          </div>
          <Text variant="muted" as="div" className="text-xs">
            {t('entropyGame.bits', { bits: String(bits), total: String(GENERATED_MNEMONIC_STRENGTH_BITS) })}
          </Text>
        </Container>
      </div>

      <div className={cn('grid gap-2', kind === 'coin' ? 'grid-cols-2' : 'grid-cols-6')}>
        {(kind === 'coin' ? [1, 0] : PHYSICAL_ENTROPY_FACES.dice).map((value) => (
          <ButtonSecondary
            key={value}
            small
            disabled={locked || complete}
            onClick={() => record(value)}
            aria-label={t('entropyGame.record', { value: faceLabel(value) })}
          >
            {kind === 'coin'
              ? <span>{faceLabel(value)} <span className="mono opacity-70">({value})</span></span>
              : <DieFace value={value} />}
          </ButtonSecondary>
        ))}
      </div>

      <Text variant="muted" as="div" className="text-xs text-center">
        {t(kind === 'coin' ? 'entropyGame.coinKeys' : 'entropyGame.diceKeys')}
      </Text>

      {results.length > 0 && (
        <div className="flex flex-wrap gap-1 max-h-[96px] overflow-y-auto p-2 rounded-md bg-sunken" aria-label={t('entropyGame.resultsLabel')}>
          {results.map((value, i) => (
            <span
              key={i}
              className={cn(
                'mono inline-flex items-center justify-center w-7 h-7 rounded-sm text-xs font-semibold',
                i === results.length - 1 ? 'bg-brand text-on-brand animate-result-pop' : 'bg-card text-secondary',
              )}
            >
              {value}
            </span>
          ))}
        </div>
      )}

      <StatusNotice variant="callout" tone="warn" icon={<IconWarning />}>
        {t('entropyGame.honesty')}
      </StatusNotice>

      <Container variant="row" gap={3}>
        <ButtonSecondary small className="flex-1" disabled={locked || results.length === 0} onClick={undo}>
          {t('entropyGame.undo')}
        </ButtonSecondary>
        <ButtonSecondary small className="flex-1" disabled={locked || results.length === 0} onClick={() => setResults([])}>
          {t('entropyGame.startOver')}
        </ButtonSecondary>
      </Container>

      {complete && (
        <Button onClick={accept} disabled={locked}>
          {busy ? t('entropyGame.building') : t('entropyGame.useSeed')}
        </Button>
      )}
      <ScreenReaderStatus>{last === null ? '' : t('entropyGame.recorded', { value: faceLabel(last), count: String(results.length), total: String(required) })}</ScreenReaderStatus>
    </Container>
  );
}
