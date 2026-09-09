import { useState } from 'react';
import { t, getSupportedLanguages, getLanguage, setLanguage } from '@services/i18n/i18n.ts';
import Button from '@components/Button/Button';
import Modal from '@components/Modal/Modal';
import LanguageWheel from '@components/LanguageWheel/LanguageWheel';
import type { Language } from '@domain/i18n/language.ts';

/**
 * Pick the interface language.
 *
 * Its own component because it is a self-contained dialog with two pieces of
 * state that the menu was carrying for it. The wizard has a second surface for
 * this feature — a full-bleed first-run panel rather than a dialog, needed
 * because it runs before there is any popup chrome to hang a dialog on — so
 * only the inner wheel (`LanguageWheel`) is shared between the two.
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
        <LanguageWheel languages={languages} selected={selected} onChange={setSelected} />
      </Modal>
  );
}
