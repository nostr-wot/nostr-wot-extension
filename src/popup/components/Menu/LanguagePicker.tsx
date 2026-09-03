import React, { useState } from 'react';
import { t, getSupportedLanguages, getLanguage, setLanguage } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import Modal from '@components/Modal/Modal';
import ScrollWheelPicker from '@components/ScrollWheelPicker/ScrollWheelPicker';
import styles from './MenuOverlay.module.css';

export interface Language {
  code: string;
  flag: string;
  native: string;
  prompt: string;
}

/**
 * Pick the interface language.
 *
 * Its own component because it is a self-contained dialog with two pieces of
 * state that the menu was carrying for it, and because the wizard has a second
 * copy of this feature — a full-bleed panel rather than a dialog — that should
 * eventually meet it here.
 */
export default function LanguagePicker({ onClose }: { onClose: () => void }) {
  const languages: Language[] = getSupportedLanguages();
  const current = getLanguage();
  const [selected, setSelected] = useState<Language | null>(
    languages.find((l) => l.code === current) ?? languages[0],
  );

  const confirm = async () => {
    if (selected) await setLanguage(selected.code);
    onClose();
  };

  return (
      <Modal
        title={selected?.prompt || languages[0].prompt}
        onClose={() => onClose()}
        zIndex={720}
        footer={<Button onClick={confirm}>{t('common.confirm')}</Button>}
      >
        <div className={styles.langModalWheel}>
          <ScrollWheelPicker
            items={languages}
            selectedIndex={selected ? languages.findIndex((l: Language) => l.code === selected.code) : 0}
            onChange={(i: number) => setSelected(languages[i])}
            renderItem={(lang: Language, _i: number, isActive: boolean) => (
              <div className={`${styles.langWheelItem} ${isActive ? styles.langWheelItemActive : ''}`}>
                <span className={styles.langWheelFlag}>{lang.flag}</span>
                <span className={styles.langWheelName}>{lang.native}</span>
              </div>
            )}
          />
        </div>
      </Modal>
  );
}
