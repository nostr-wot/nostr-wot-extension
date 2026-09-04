import React, { useState, useMemo } from 'react';
import { getSupportedLanguages, setLanguage, getLanguage, t } from '@lib/i18n.js';
import TopoBg from '@components/TopoBg/TopoBg';
import AnimatedWotLogo from '@components/AnimatedWotLogo/AnimatedWotLogo';
import Button from '@components/Button/Button';
import Card from '@components/Card/Card';
import IconButton from '@components/IconButton/IconButton';
import { IconClose } from '@assets';
import LanguageWheel from '@components/LanguageWheel/LanguageWheel';
import styles from './WizardOverlay.module.css';
import type { Language } from '@models/language.ts';

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
      <TopoBg className={styles.langScreen}>
        <div className={styles.langHero}>
          <AnimatedWotLogo size={112} />
          <span className={styles.langAppName}>Nostr WoT</span>
        </div>
        <div className={styles.langDivider} />
        <div className={styles.langPicker}>
          <Card variant="flat" className={styles.langTrigger}>
            <span className={styles.langTriggerSelected}>{lang.flag} {lang.native}</span>
          </Card>
          <Button
            className={styles.langConfirm}
            onClick={() => { setLanguage(lang.code); onSelect(lang.code); }}
          >
            {t('common.continue')}
          </Button>
        </div>
      </TopoBg>
    );
  }

  return (
    <TopoBg className={styles.langScreen}>
      {anim && <style>{anim.css}</style>}
      <div className={styles.langHero}>
        <AnimatedWotLogo size={112} />
        <span className={styles.langAppName}>Nostr WoT</span>
      </div>
      <div className={styles.langDivider} />
      <div className={styles.langPicker}>
        {/* Dropdown trigger -- cycles prompt translations or shows selection.
            Card gives it native button semantics (keyboard activation, focus)
            for free, dropping the hand-rolled role/tabIndex/onKeyDown trio. */}
        <Card as="button" variant="flat" className={styles.langTrigger} onClick={() => setModalOpen(true)}>
          {selected ? (
            <span className={styles.langTriggerSelected}>
              {selected.flag} {selected.native}
            </span>
          ) : (
            <div className={styles.langTriggerScroll}>
              <div
                className={styles.langTriggerTrack}
                style={{ animation: `langPromptScroll ${anim!.duration}s linear infinite` }}
              >
                {languages.map((lang) => (
                  <div key={lang.code} className={styles.langTriggerItem}>
                    {lang.prompt}
                  </div>
                ))}
                {/* Duplicate first for seamless loop */}
                <div className={styles.langTriggerItem}>
                  {languages[0].prompt}
                </div>
              </div>
            </div>
          )}
          <svg className={styles.langTriggerChevron} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </Card>
        <Button className={styles.langConfirm} onClick={handleConfirm}>
          {t('common.continue')}
        </Button>
      </div>

      {/* Full-screen language modal with scroll wheel picker */}
      {modalOpen && (
        <div className={styles.langModal}>
          <div className={styles.langModalHeader}>
            <span className={styles.langModalTitle}>
              {selected?.prompt || languages[0].prompt}
            </span>
            <IconButton size={32} onClick={() => setModalOpen(false)} aria-label={t('common.close')}>
              <IconClose size={18} />
            </IconButton>
          </div>

          <LanguageWheel languages={languages} selected={selected} onChange={setSelected} />

          <div className={styles.langModalBottom}>
            <Button className={styles.langConfirm} onClick={handleConfirm}>
              {t('common.continue')}
            </Button>
          </div>
        </div>
      )}
    </TopoBg>
  );
}
