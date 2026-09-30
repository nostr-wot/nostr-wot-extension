import { THEME_OPTIONS } from '@constants/appearance.ts';
import type { ThemePreference } from './theme.ts';

/** URL handoffs never accept arbitrary CSS or a custom palette. */
export function themeFromSearch(search: string): Exclude<ThemePreference, 'custom'> | null {
  const values = new URLSearchParams(search).getAll('theme');
  const value = values[0];
  return values.length === 1 && value !== 'custom' && THEME_OPTIONS.includes(value as ThemePreference)
    ? value as Exclude<ThemePreference, 'custom'> : null;
}

export function downloadTheme(raw: string): Exclude<ThemePreference, 'custom'> | null {
  try {
    const url = new URL(raw);
    if (url.origin !== 'https://nostr-wot.com' || url.username || url.password
      || !/^\/(?:en\/|es\/|pt\/|de\/|fr\/|it\/|ru\/)?download\/?$/.test(url.pathname)) return null;
    return themeFromSearch(url.search);
  } catch { return null; }
}
