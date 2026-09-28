import { useId, useState } from 'react';
import Button from '@components/Button';
import Card from '@components/Card';
import Dropdown from '@components/Dropdown';
import { SectionLabel } from '@components/SectionLabel';
import Container from '@components/Container';
import FormError from '@components/FormError';
import Text from '@components/Text';
import ListRow from '@components/ListRow';
import LanguagePicker from './LanguagePicker';
import CustomThemeEditor from './CustomThemeEditor';
import { THEME_OPTIONS, THEME_STORAGE_KEY, APPEARANCE_MODE_STORAGE_KEY, APPEARANCE_MODES } from '@constants/appearance.ts';
import { appearanceMode, supportsAppearanceMode, themePreference, type AppearanceMode, type ThemePreference } from '@domain/appearance/theme.ts';
import useStorageWatch from '@hooks/useStorageWatch.ts';
import { saveTheme } from '@services/appearance/theme.ts';
import { t, getSupportedLanguages, getLanguage } from '@services/i18n/i18n.ts';

const PROJECT_LABELS: Partial<Record<ThemePreference, string>> = {
  default: 'Nostr WoT', coracle: 'Coracle', nostrudel: 'noStrudel', yakihonne: 'YakiHonne', nostrich: 'Nostrich',
};
const PRESETS = THEME_OPTIONS.filter(value => !['custom', 'light', 'dark', 'system'].includes(value));

export default function AppearanceSection() {
  const themeId = useId();
  const modeId = useId();
  const [selected, setSelected] = useState(() => themePreference(document.documentElement.dataset.themePreference));
  const [mode, setMode] = useState(() => appearanceMode(document.documentElement.dataset.appearanceMode, selected));
  const project = ['light', 'dark', 'system'].includes(selected) ? 'default' : selected;
  const [languageOpen, setLanguageOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const currentLanguage = getSupportedLanguages().find(language => language.code === getLanguage()) ?? getSupportedLanguages()[0];
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useStorageWatch([{ area: 'local', keys: [THEME_STORAGE_KEY, APPEARANCE_MODE_STORAGE_KEY] }], () => {
    setSelected(themePreference(document.documentElement.dataset.themePreference));
    setMode(appearanceMode(document.documentElement.dataset.appearanceMode));
  });
  async function select(value: ThemePreference, nextMode: AppearanceMode = mode) {
    setSaving(true); setError('');
    try { await saveTheme(value, nextMode); setSelected(value); setMode(nextMode); }
    catch { setError(t('theme.saveError')); }
    finally { setSaving(false); }
  }
  return <Container gap={6}>
    <Card>
      <Container gap={6}>
        <SectionLabel htmlFor={themeId}>{t('theme.title')}</SectionLabel>
        <Text variant="hint">{t('theme.description')}</Text>
        <Dropdown id={themeId} options={[
          ...PRESETS.map(value => ({ value, label: PROJECT_LABELS[value] ?? t(`theme.${value}`) })),
          ...(selected === 'custom' ? [{ value: 'custom', label: 'Custom', disabled: true }] : []),
        ]} value={project} onChange={value => select(themePreference(value))} disabled={saving} />
        {supportsAppearanceMode(selected) ? <>
          <SectionLabel htmlFor={modeId}>Appearance</SectionLabel>
          <Dropdown id={modeId} options={APPEARANCE_MODES.map(value => ({ value, label: t(`theme.${value}`) }))}
            value={mode} onChange={value => select(project, appearanceMode(value))} disabled={saving} />
        </> : <Text variant="hint">This theme has one palette and keeps its original appearance.</Text>}
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
