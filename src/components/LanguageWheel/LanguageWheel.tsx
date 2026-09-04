import ScrollWheelPicker from '@components/ScrollWheelPicker/ScrollWheelPicker';
import type { Language } from '@models/language.ts';
import styles from './LanguageWheel.module.css';

interface LanguageWheelProps {
  languages: Language[];
  selected: Language | null;
  onChange: (language: Language) => void;
}

/**
 * The scroll-wheel language list: flag, native name, bold when centered.
 *
 * Both the wizard's full-bleed language screen and the popup menu's
 * LanguagePicker dialog wrapped ScrollWheelPicker with this exact item
 * template, each with its own identical copy of the CSS. The surrounding
 * chrome is deliberately not shared — the wizard screen is a first-run panel
 * with its own hero and animated trigger, the popup one a Modal dialog — only
 * this inner piece is the same feature twice.
 */
export default function LanguageWheel({ languages, selected, onChange }: LanguageWheelProps) {
  return (
    <div className={styles.wheelWrap}>
      <ScrollWheelPicker
        items={languages}
        selectedIndex={selected ? languages.findIndex((l) => l.code === selected.code) : 0}
        onChange={(i: number) => onChange(languages[i])}
        renderItem={(lang: Language, _i: number, isActive: boolean) => (
          <div className={`${styles.wheelItem} ${isActive ? styles.wheelItemActive : ''}`}>
            <span className={styles.wheelFlag}>{lang.flag}</span>
            <span className={styles.wheelName}>{lang.native}</span>
          </div>
        )}
      />
    </div>
  );
}
