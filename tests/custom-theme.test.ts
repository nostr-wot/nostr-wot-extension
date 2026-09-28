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

describe('independent appearance mode', () => {
  it('resolves each project palette without changing its identity', async () => {
    const { resolveTheme, appearanceMode, supportsAppearanceMode } = await import('../src/domain/appearance/theme.ts');
    for (const project of ['coracle', 'nostrudel', 'yakihonne', 'nostrich'] as const) {
      assert.equal(resolveTheme(project, true, 'light'), `${project}-light`);
      assert.equal(resolveTheme(project, false, 'dark'), project);
      assert.equal(resolveTheme(project, false, 'system'), `${project}-light`);
      assert.equal(resolveTheme(project, true, 'system'), project);
      assert.equal(supportsAppearanceMode(project), true);
    }
    for (const fixed of ['lacrypta', 'custom'] as const) {
      assert.equal(resolveTheme(fixed, false, 'light'), fixed);
      assert.equal(supportsAppearanceMode(fixed), false);
    }
    assert.equal(resolveTheme('default', true, 'system'), 'dark');
    assert.equal(resolveTheme('default', true, 'light'), 'light');
    assert.equal(appearanceMode(undefined, 'system'), 'system');
    assert.equal(appearanceMode(undefined, 'dark'), 'dark');
    assert.equal(appearanceMode(undefined, 'coracle'), 'dark');
    assert.equal(appearanceMode('invalid', 'light'), 'light');
    assert.equal(appearanceMode('light', 'coracle'), 'light');
  });
});
