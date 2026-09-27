import { useState } from 'react';
import Button from '@components/Button';
import Card from '@components/Card';
import ChipGroup from '@components/ChipGroup';
import Container from '@components/Container';
import FormError from '@components/FormError';
import Text from '@components/Text';
import ListRow from '@components/ListRow';
import LanguagePicker from './LanguagePicker';
import CustomThemeEditor from './CustomThemeEditor';
import { THEME_OPTIONS, THEME_STORAGE_KEY } from '@constants/appearance.ts';
import { themePreference, type ThemePreference } from '@domain/appearance/theme.ts';
import useStorageWatch from '@hooks/useStorageWatch.ts';
import { saveTheme } from '@services/appearance/theme.ts';
import { t, getSupportedLanguages, getLanguage } from '@services/i18n/i18n.ts';

const PROJECT_LABELS: Partial<Record<ThemePreference, string>> = {
  coracle: 'Coracle', nostrudel: 'noStrudel', yakihonne: 'YakiHonne', nostrich: 'Nostrich',
};
const PRESETS = THEME_OPTIONS.filter(value => value !== 'custom');

export default function AppearanceSection() {
  const [selected, setSelected] = useState(() => themePreference(document.documentElement.dataset.themePreference));
  const [languageOpen, setLanguageOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const currentLanguage = getSupportedLanguages().find(language => language.code === getLanguage()) ?? getSupportedLanguages()[0];
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useStorageWatch([{ area: 'local', keys: [THEME_STORAGE_KEY] }], () => {
    setSelected(themePreference(document.documentElement.dataset.themePreference));
  });
  async function select(value: ThemePreference) {
    setSaving(true); setError('');
    try { await saveTheme(value); setSelected(value); }
    catch { setError(t('theme.saveError')); }
    finally { setSaving(false); }
  }
  return <Container gap={6}>
    <Card>
      <Container gap={6}>
        <Text as="strong">{t('theme.title')}</Text>
        <Text variant="hint">{t('theme.description')}</Text>
        <ChipGroup options={PRESETS.map(value => ({ value, label: PROJECT_LABELS[value] ?? t(`theme.${value}`) }))}
          value={selected} onChange={select} disabled={saving} />
        <Button type="button" variant="secondary" onClick={() => setCustomOpen(open => !open)}>
          {selected === 'custom' ? 'Edit custom theme' : 'Create custom theme'}
        </Button>
        <FormError>{error}</FormError>
      </Container>
    </Card>
    {customOpen && <CustomThemeEditor onSaved={() => { setSelected('custom'); setCustomOpen(false); }} onClose={() => setCustomOpen(false)} />}
    <ListRow variant="standalone" title={t('settings.language')}
      subtitle={currentLanguage.native} leading={<span aria-hidden="true">{currentLanguage.flag}</span>}
      onClick={() => setLanguageOpen(true)} />
    {languageOpen && <LanguagePicker onClose={() => setLanguageOpen(false)} />}
  </Container>;
}
