import { THEME_OPTIONS, APPEARANCE_MODES } from '@constants/appearance.ts';

export type ThemePreference = typeof THEME_OPTIONS[number];
export type AppearanceMode = typeof APPEARANCE_MODES[number];
export type ProjectTheme = 'coracle' | 'nostrudel' | 'yakihonne' | 'nostrich';
export type ResolvedTheme = Exclude<ThemePreference, 'system' | 'default'> | `${ProjectTheme}-light`;

export function supportsAppearanceMode(theme: ThemePreference): boolean {
  return theme !== 'lacrypta' && theme !== 'custom';
}

export function appearanceMode(value: unknown, legacy: ThemePreference = 'default'): AppearanceMode {
  if (APPEARANCE_MODES.includes(value as AppearanceMode)) return value as AppearanceMode;
  if (legacy === 'light' || legacy === 'dark' || legacy === 'system') return legacy;
  return legacy === 'default' ? 'system' : 'dark';
}

export const CUSTOM_THEME_KEYS = [
  'bgPage', 'bgPageSolid', 'bgHtml', 'bgElevated', 'surfaceHover', 'inputBg',
  'textHeading', 'textBody', 'textSecondary', 'textMuted', 'brand', 'brandHover',
  'textOnBrand', 'cardBg', 'cardBorder', 'controlBorder', 'success', 'error', 'warning', 'info',
] as const;
export type CustomThemeKey = typeof CUSTOM_THEME_KEYS[number];
export type CustomTheme = Record<CustomThemeKey, string>;

const COLOR = /^(#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/i;

export function themePreference(value: unknown): ThemePreference {
  return THEME_OPTIONS.includes(value as ThemePreference) ? value as ThemePreference : 'light';
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean, mode?: AppearanceMode): ResolvedTheme {
  if (preference === 'lacrypta' || preference === 'custom') return preference;
  const selected = appearanceMode(mode, preference);
  const resolved = selected === 'system' ? (prefersDark ? 'dark' : 'light') : selected;
  if (preference === 'default' || preference === 'light' || preference === 'dark' || preference === 'system') return resolved;
  return resolved === 'light' ? `${preference}-light` : preference;
}

export function parseCustomTheme(input: unknown): CustomTheme {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Theme must be a JSON object');
  const source = input as Record<string, unknown>;
  const unknown = Object.keys(source).filter(key => !(CUSTOM_THEME_KEYS as readonly string[]).includes(key));
  if (unknown.length) throw new Error(`Unknown theme colors: ${unknown.join(', ')}`);
  const result = {} as CustomTheme;
  for (const key of CUSTOM_THEME_KEYS) {
    const value = source[key];
    if (typeof value !== 'string' || !COLOR.test(value)) throw new Error(`Invalid or missing color: ${key}`);
    result[key] = value;
  }
  return result;
}

export function parseCustomThemeJson(json: string): CustomTheme {
  return parseCustomTheme(JSON.parse(json));
}
