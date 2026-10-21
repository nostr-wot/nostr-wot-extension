import { useEffect, useState } from 'react';
import browser from '@lib/browser.ts';
import { t } from '@services/i18n/i18n.ts';
import {
  PHYSICAL_ENTROPY_FACES, PHYSICAL_ENTROPY_REQUIRED, isPhysicalResult, physicalEntropyBits, restoreEntropyProgress,
  type PhysicalEntropyKind,
} from '@domain/accounts/physicalEntropy.ts';
import { GENERATED_MNEMONIC_STRENGTH_BITS } from '@constants/accounts.ts';
import IconWarning from '@assets/IconWarning.tsx';
import Button, { ButtonSecondary } from '@components/Button';
import Card from '@components/Card';
import Container from '@components/Container';
import ScreenReaderStatus from '@components/ScreenReaderStatus';
import StatusNotice from '@components/StatusNotice';
import Tabs from '@components/Tabs';
import Text from '@components/Text';
import { cn } from '@utils/cn.ts';
import { Coin, Die, DieFace } from './EntropyArt';

/** In-progress results survive the popup closing, like the generated phrase does. */
export const ENTROPY_GAME_STORAGE_KEY = 'wizardEntropyGame';

/** Drop saved progress once it has been used or the wizard moves on. */
export function clearEntropyProgress(): void {
  browser.storage.session.remove(ENTROPY_GAME_STORAGE_KEY).catch(() => {});
}

interface EntropyGameProps {
  /** Called with the complete list of results when the person accepts them. */
  onComplete: (kind: PhysicalEntropyKind, results: number[]) => Promise<void> | void;
  disabled?: boolean;
}

/**
 * Record real coin flips or dice rolls, one at a time, until they cover a
 * 256-bit seed. Every new result tosses the coin or rolls the die on screen.
 */
export default function EntropyGame({ onComplete, disabled = false }: EntropyGameProps) {
  const [kind, setKind] = useState<PhysicalEntropyKind>('dice');
  const [results, setResults] = useState<number[]>([]);
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    browser.storage.session.get(ENTROPY_GAME_STORAGE_KEY)
      .then((saved) => {
        const progress = restoreEntropyProgress((saved as Record<string, unknown>)[ENTROPY_GAME_STORAGE_KEY]);
        if (progress) { setKind(progress.kind); setResults(progress.results); }
      })
      .catch(() => {})
      .finally(() => setRestored(true));
  }, []);

  useEffect(() => {
    if (!restored) return;
    if (results.length === 0) { clearEntropyProgress(); return; }
    browser.storage.session.set({ [ENTROPY_GAME_STORAGE_KEY]: { kind, results, ts: Date.now() } }).catch(() => {});
  }, [restored, kind, results]);

  const required = PHYSICAL_ENTROPY_REQUIRED[kind];
  const complete = results.length >= required;
  const last = results.length ? results[results.length - 1] : null;
  const bits = physicalEntropyBits(kind, results.length);
  const locked = disabled || busy;

  const record = (value: number) => {
    if (locked || complete || !isPhysicalResult(kind, value)) return;
    setResults((prev) => (prev.length < required ? [...prev, value] : prev));
  };

  // Digit keys record a result, so a long session can be typed without the mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Typing elsewhere (the encrypted-backup dialog, a field) is not a roll.
      const target = event.target as Partial<Element> | null;
      if (typeof target?.closest === 'function' && target.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return;
      if (event.key === 'Backspace') { setResults((prev) => prev.slice(0, -1)); return; }
      if (!/^\d$/.test(event.key)) return;
      record(Number(event.key));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const accept = async () => {
    if (!complete || locked) return;
    setBusy(true);
    try {
      await onComplete(kind, results);
      clearEntropyProgress();
      setResults([]);
    } finally {
      setBusy(false);
    }
  };

  const faceLabel = (value: number) => (kind === 'coin'
    ? t(value === 1 ? 'entropyGame.heads' : 'entropyGame.tails')
    : String(value));

  return (
    <Card variant="flat" className="p-6 mb-0">
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
          <ButtonSecondary small className="flex-1" disabled={locked || results.length === 0} onClick={() => setResults((prev) => prev.slice(0, -1))}>
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
      </Container>
      <ScreenReaderStatus>{last === null ? '' : t('entropyGame.recorded', { value: faceLabel(last), count: String(results.length), total: String(required) })}</ScreenReaderStatus>
    </Card>
  );
}
