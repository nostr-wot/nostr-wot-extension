import React, { useState, useMemo } from 'react';
import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import Card from '@components/Card/Card';
import SeedWord from '@components/SeedWord/SeedWord';
import Chip from '@components/Chip/Chip';

// Decoy words from BIP-39 for verification
const DECOYS = ['abandon', 'ability', 'achieve', 'acquire', 'adapt', 'adjust', 'admit', 'afford'];

function pickRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

interface VerifyStepProps {
  mnemonic: string | null;
  onVerified: () => void;
}

export default function VerifyStep({ mnemonic, onVerified }: VerifyStepProps) {
  const words = useMemo(() => (mnemonic || '').split(' '), [mnemonic]);

  // Pick 4 random positions to blank
  const blankIndices = useMemo(() => {
    const indices = words.map((_, i) => i);
    return pickRandom(indices, 4).sort((a, b) => a - b);
  }, [words]);

  // Word bank: 4 correct + 4 decoys, shuffled
  const wordBank = useMemo(() => {
    const correct = blankIndices.map((i) => words[i]);
    const available = DECOYS.filter((d) => !correct.includes(d));
    const decoys = pickRandom(available, 4);
    return [...correct, ...decoys].sort(() => Math.random() - 0.5);
  }, [blankIndices, words]);

  const [filledSlots, setFilledSlots] = useState<Record<number, string>>({});
  const [selectedChips, setSelectedChips] = useState<Set<string>>(new Set());
  const [wrongSlots, setWrongSlots] = useState<Set<number>>(new Set());
  const [verified, setVerified] = useState<boolean>(false);

  const nextEmptySlot = blankIndices.find((i) => filledSlots[i] === undefined);

  const handleChipClick = (word: string) => {
    if (selectedChips.has(word) || verified) return;
    if (nextEmptySlot === undefined) return;

    const newFilled = { ...filledSlots, [nextEmptySlot]: word };
    const newSelected = new Set(selectedChips);
    newSelected.add(word);

    // Clear wrong state when user places a new word
    const newWrong = new Set(wrongSlots);
    newWrong.delete(nextEmptySlot);

    setFilledSlots(newFilled);
    setSelectedChips(newSelected);
    setWrongSlots(newWrong);

    // Check if all slots are filled
    if (Object.keys(newFilled).length === blankIndices.length) {
      const allCorrect = blankIndices.every((i) => newFilled[i] === words[i]);
      if (allCorrect) {
        setVerified(true);
      } else {
        // Highlight wrong slots so user can click to fix them
        const wrong = new Set<number>();
        blankIndices.forEach((i) => {
          if (newFilled[i] !== words[i]) wrong.add(i);
        });
        setWrongSlots(wrong);
      }
    }
  };

  const handleSlotClick = (slotIndex: number) => {
    if (verified) return;
    const word = filledSlots[slotIndex];
    if (word === undefined) return;

    const newFilled = { ...filledSlots };
    delete newFilled[slotIndex];
    const newSelected = new Set(selectedChips);
    newSelected.delete(word);
    const newWrong = new Set(wrongSlots);
    newWrong.delete(slotIndex);

    setFilledSlots(newFilled);
    setSelectedChips(newSelected);
    setWrongSlots(newWrong);
  };

  return (
    <div className="flex flex-col flex-1">
      <h2 className="text-3xl font-bold text-heading mb-3">{t('wizard.verifyTitle')}</h2>
      <p className="text-md text-secondary leading-normal mb-8">
        {t('wizard.verifyDesc')}
      </p>

      <Card
        variant="flat"
        className={`grid gap-1 pt-5 px-7 pb-16 mb-0 ${words.length > 12 ? 'grid-cols-4 gap-y-2 gap-x-1' : 'grid-cols-3'}`}
      >
        {words.map((word, i) => {
          const isBlank = blankIndices.includes(i);
          const filled = filledSlots[i];
          const isWrong = wrongSlots.has(i);
          const isClickable = isBlank && filled !== undefined && !verified;
          return (
            <SeedWord
              key={i}
              index={i + 1}
              word={isBlank ? (filled || '___') : word}
              compact={words.length > 12}
              className={`${isBlank ? 'text-brand font-bold' : ''} ${isWrong ? 'text-error bg-[rgb(220_38_38_/_0.06)] rounded-sm animate-shake' : ''}`}
              onClick={isClickable ? () => handleSlotClick(i) : undefined}
            />
          );
        })}
      </Card>

      {!verified && (
        <div className="grid grid-cols-4 gap-3 mt-6">
          {/* toggle={false}: tapping a word consumes it into a slot, it is not
              a switch. aria-pressed here would announce every available word as
              "not pressed". */}
          {wordBank.map((word) => (
            <Chip
              key={word}
              toggle={false}
              disabled={selectedChips.has(word)}
              onClick={() => handleChipClick(word)}
            >
              {word}
            </Chip>
          ))}
        </div>
      )}

      {verified && (
        <div className="flex gap-4 mt-auto py-8 sticky bottom-0 z-[1] [background:var(--bg-page)]">
          <Button className="flex-1" onClick={onVerified}>{t('common.continue')}</Button>
        </div>
      )}
    </div>
  );
}
