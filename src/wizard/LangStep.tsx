import { useState, useMemo } from 'react';
import { getSupportedLanguages, setLanguage, getLanguage, t } from '@lib/i18n.js';
import TopoBg from '@components/TopoBg/TopoBg';
import AnimatedWotLogo from '@components/AnimatedWotLogo/AnimatedWotLogo';
import Button from '@components/Button/Button';
import Card from '@components/Card/Card';
import IconButton from '@components/IconButton/IconButton';
import { IconClose } from '@assets';
import LanguageWheel from '@components/LanguageWheel/LanguageWheel';
import type { Language } from '@domain/i18n/language.ts';
import Container from '@components/Container/Container';

const ITEM_H = 36;
const PAUSE = 2.5;
const SLIDE = 0.4;
const STEP = PAUSE + SLIDE;

interface ScrollKeyframes {
  css: string;
  duration: number;
}

function buildScrollKeyframes(n: number): ScrollKeyframes | null {
  if (n <= 1) return null;
  const total = n * STEP;
  const lines: string[] = ['@keyframes langPromptScroll {'];
  for (let i = 0; i < n; i++) {
    const holdStart = ((i * STEP) / total) * 100;
    const holdEnd = ((i * STEP + PAUSE) / total) * 100;
    const slideEnd = (((i + 1) * STEP) / total) * 100;
    lines.push(`  ${holdStart.toFixed(2)}% { transform: translateY(-${i * ITEM_H}px); }`);
    lines.push(`  ${holdEnd.toFixed(2)}% { transform: translateY(-${i * ITEM_H}px); }`);
    if (i < n - 1) {
      lines.push(`  ${slideEnd.toFixed(2)}% { transform: translateY(-${(i + 1) * ITEM_H}px); }`);
    }
  }
  lines.push(`  100.00% { transform: translateY(-${n * ITEM_H}px); }`);
  lines.push('}');
  return { css: lines.join('\n'), duration: total };
}

interface LangStepProps {
  onSelect: (code: string) => void;
}

export default function LangStep({ onSelect }: LangStepProps) {
  const languages: Language[] = getSupportedLanguages();
  const currentCode = getLanguage();
  const initialIdx = languages.findIndex((l) => l.code === currentCode);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [selected, setSelected] = useState<Language>(languages[initialIdx >= 0 ? initialIdx : 0]);

  const anim = useMemo(() => buildScrollKeyframes(languages.length), [languages.length]);

  const handleConfirm = async () => {
    await setLanguage(selected.code);
    onSelect(selected.code);
  };

  // Single language -- skip picker entirely
  if (languages.length === 1) {
    const lang = languages[0];
    return (
      <TopoBg className="flex flex-col flex-1 text-center">
        <Container gap={5} className="flex-1 items-center justify-center">
          <AnimatedWotLogo size={112} />
          <span className="text-[26px] font-heavy text-heading tracking-[-0.3px]">Nostr WoT</span>
        </Container>
        <div className="h-px bg-card-border mx-12" />
        <Container gap={6} className="pt-10 px-8 pb-4 items-center">
          <Card variant="flat" className="flex items-center gap-4 w-full max-w-[260px] px-7 h-22 mb-0 bg-[rgba(255,255,255,0.5)] cursor-pointer transition-colors hover:border-brand">
            <span className="flex-1 text-lg font-semibold text-heading">{lang.flag} {lang.native}</span>
          </Card>
          <Button
            className="w-full max-w-[260px]"
            onClick={() => { void setLanguage(lang.code); onSelect(lang.code); }}
          >
            {t('common.continue')}
          </Button>
        </Container>
      </TopoBg>
    );
  }

  return (
    <TopoBg className="flex flex-col flex-1 text-center">
      {anim && <style>{anim.css}</style>}
      <Container gap={5} className="flex-1 items-center justify-center">
        <AnimatedWotLogo size={112} />
        <span className="text-[26px] font-heavy text-heading tracking-[-0.3px]">Nostr WoT</span>
      </Container>
      <div className="h-px bg-card-border mx-12" />
      <Container gap={6} className="pt-10 px-8 pb-4 items-center">
        {/* Dropdown trigger -- cycles prompt translations or shows selection.
            Card gives it native button semantics (keyboard activation, focus)
            for free, dropping the hand-rolled role/tabIndex/onKeyDown trio. */}
        <Card
          as="button"
          variant="flat"
          className="flex items-center gap-4 w-full max-w-[260px] px-7 h-22 mb-0 bg-[rgba(255,255,255,0.5)] cursor-pointer transition-colors hover:border-brand"
          onClick={() => setModalOpen(true)}
        >
          {selected ? (
            <span className="flex-1 text-lg font-semibold text-heading">
              {selected.flag} {selected.native}
            </span>
          ) : (
            <div className="flex-1 overflow-hidden h-9">
              <div
                className="flex flex-col"
                style={{ animation: `langPromptScroll ${anim!.duration}s linear infinite` }}
              >
                {languages.map((lang) => (
                  <div key={lang.code} className="h-9 flex items-center text-lg font-normal text-muted shrink-0 whitespace-nowrap">
                    {lang.prompt}
                  </div>
                ))}
                {/* Duplicate first for seamless loop */}
                <div className="h-9 flex items-center text-lg font-normal text-muted shrink-0 whitespace-nowrap">
                  {languages[0].prompt}
                </div>
              </div>
            </div>
          )}
          <svg className="shrink-0 text-muted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </Card>
        <Button className="w-full max-w-[260px]" onClick={handleConfirm}>
          {t('common.continue')}
        </Button>
      </Container>

      {/* Full-screen language modal with scroll wheel picker */}
      {modalOpen && (
        <div className="absolute inset-0 z-sheet flex flex-col [background:var(--bg-page)] animate-lang-modal-in">
          <div className="flex items-center justify-between py-7 px-8 border-b border-card-border">
            <span className="text-xl font-bold text-heading">
              {selected?.prompt || languages[0].prompt}
            </span>
            <IconButton size={32} onClick={() => setModalOpen(false)} aria-label={t('common.close')}>
              <IconClose size={18} />
            </IconButton>
          </div>

          <LanguageWheel languages={languages} selected={selected} onChange={setSelected} />

          <div className="p-8">
            <Button className="w-full" onClick={handleConfirm}>
              {t('common.continue')}
            </Button>
          </div>
        </div>
      )}
    </TopoBg>
  );
}
