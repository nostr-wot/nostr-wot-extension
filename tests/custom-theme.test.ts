import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CUSTOM_THEME_KEYS, parseCustomTheme, parseCustomThemeJson, resolveTheme, themePreference } from '../src/domain/appearance/theme.ts';

const valid = Object.fromEntries(CUSTOM_THEME_KEYS.map((key, index) => [key, index % 2 ? '#112233' : '#abcdef']));

describe('project and custom themes', () => {
  it('accepts all project presets', () => {
    for (const name of ['coracle', 'nostrudel', 'yakihonne', 'nostrich', 'custom'] as const) {
      assert.equal(themePreference(name), name);
      assert.equal(resolveTheme(name, false), name);
    }
  });

  it('accepts a complete safe JSON palette', () => {
    assert.deepEqual(parseCustomThemeJson(JSON.stringify(valid)), valid);
  });

  it('rejects missing, unknown and executable CSS values', () => {
    const missing = { ...valid }; delete (missing as Record<string, string>).brand;
    assert.throws(() => parseCustomTheme(missing), /brand/);
    assert.throws(() => parseCustomTheme({ ...valid, surprise: '#ffffff' }), /Unknown/);
    assert.throws(() => parseCustomTheme({ ...valid, brand: 'url(https://example.com/x)' }), /brand/);
    assert.throws(() => parseCustomThemeJson('{bad json'), SyntaxError);
  });
});
