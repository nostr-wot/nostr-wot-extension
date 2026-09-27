import { useEffect, useState } from 'react';
import Button, { ButtonSecondary } from '@components/Button';
import Card from '@components/Card';
import Container from '@components/Container';
import FormError from '@components/FormError';
import Text from '@components/Text';
import Textarea from '@components/Textarea';
import { CUSTOM_THEME_KEYS, parseCustomThemeJson, type CustomTheme } from '@domain/appearance/theme.ts';
import { loadCustomTheme, saveCustomTheme } from '@services/appearance/theme.ts';

const DEFAULT: CustomTheme = {
  bgPage:'#0b0d12', bgPageSolid:'#0b0d12', bgHtml:'#07090d', bgElevated:'#151922',
  surfaceHover:'#252c38', inputBg:'#1c222c', textHeading:'#ffffff', textBody:'#e8eaf0',
  textSecondary:'#c4c8d2', textMuted:'#9da4b2', brand:'#818cf8', brandHover:'#a5b4fc',
  textOnBrand:'#080b12', cardBg:'#151922', cardBorder:'#343c4a', controlBorder:'#687386',
  success:'#6ee7b7', error:'#ff909b', warning:'#fcd17a', info:'#93c5fd',
};
const label = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());

export default function CustomThemeEditor({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [theme, setTheme] = useState<CustomTheme>(DEFAULT);
  const [json, setJson] = useState(JSON.stringify(DEFAULT, null, 2));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { void loadCustomTheme().then(saved => { if (saved) { setTheme(saved); setJson(JSON.stringify(saved, null, 2)); } }); }, []);
  function update(key: keyof CustomTheme, value: string) {
    const next = { ...theme, [key]: value };
    setTheme(next); setJson(JSON.stringify(next, null, 2)); setError('');
  }
  function parseJson() {
    try { const next = parseCustomThemeJson(json); setTheme(next); setJson(JSON.stringify(next, null, 2)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Invalid theme JSON'); }
  }
  async function save() {
    setSaving(true); setError('');
    try { const next = parseCustomThemeJson(json); await saveCustomTheme(next); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save theme'); }
    finally { setSaving(false); }
  }
  return <Card>
    <Container gap={6}>
      <Text as="strong">Custom theme</Text>
      <Text variant="hint">Set every semantic color manually, or paste a JSON theme generated elsewhere. Only the listed color tokens are accepted.</Text>
      <div className="grid grid-cols-2 gap-4">
        {CUSTOM_THEME_KEYS.map(key => <label key={key} className="flex items-center gap-3">
          <input type="color" value={theme[key].startsWith('#') && theme[key].length === 7 ? theme[key] : '#000000'}
            onChange={e => update(key, e.target.value)} className="w-10 h-10 rounded-md border border-card-border bg-transparent" />
          <span className="text-xs text-secondary">{label(key)}</span>
        </label>)}
      </div>
      <Textarea label="Theme JSON" value={json} onChange={e => setJson(e.target.value)} spellCheck={false} className="font-mono text-xs" />
      <div className="flex gap-4">
        <ButtonSecondary type="button" onClick={parseJson}>Parse JSON</ButtonSecondary>
        <Button type="button" onClick={save} disabled={saving}>Apply custom theme</Button>
        <ButtonSecondary type="button" onClick={onClose}>Cancel</ButtonSecondary>
      </div>
      <FormError>{error}</FormError>
    </Container>
  </Card>;
}
