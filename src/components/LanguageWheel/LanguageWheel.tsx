import ScrollWheelPicker from '@components/ScrollWheelPicker/ScrollWheelPicker';
import type { Language } from '@models/language.ts';
import { cn } from '@utils/cn.ts';

const WRAP = 'flex-1 flex items-center justify-center px-8';
const ITEM = 'flex items-center gap-7';
const FLAG = 'text-display leading-none';
// font-weight is the only thing that changes when centered — computed here
// instead of via the old `.wheelItemActive .wheelName` descendant rule,
// since the caller already knows isActive.
// No duration-* utility: transition-[font-weight] alone already picks up the
// house-default 0.15s (--transition) the same way transition-all does.
// Weight itself is picked below rather than layered (font-medium AND
// font-semibold both present would leave the winner to generation order).
const NAME = 'text-3xl text-heading tracking-[-0.2px] transition-[font-weight]';

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
    <div className={WRAP}>
      <ScrollWheelPicker
        items={languages}
        selectedIndex={selected ? languages.findIndex((l) => l.code === selected.code) : 0}
        onChange={(i: number) => onChange(languages[i])}
        renderItem={(lang: Language, _i: number, isActive: boolean) => (
          <div className={ITEM}>
            <span className={FLAG}>{lang.flag}</span>
            <span className={cn(NAME, isActive ? 'font-semibold' : 'font-medium')}>{lang.native}</span>
          </div>
        )}
      />
    </div>
  );
}
