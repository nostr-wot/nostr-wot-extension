import { THEME_OPTIONS } from '@constants/appearance.ts';

export type ThemePreference = typeof THEME_OPTIONS[number];
export type ResolvedTheme = 'light' | 'dark' | 'lacrypta';

export function themePreference(value: unknown): ThemePreference {
  return THEME_OPTIONS.includes(value as ThemePreference) ? value as ThemePreference : 'light';
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  return preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;
}
