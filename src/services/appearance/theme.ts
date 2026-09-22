import browser from '@lib/browser.ts';
import { THEME_STORAGE_KEY } from '@constants/appearance.ts';
import { resolveTheme, themePreference, type ThemePreference } from '@domain/appearance/theme.ts';

/** One controller per extension document; no account or vault data is involved. */
export async function initTheme(): Promise<void> {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference: ThemePreference = 'light';
  let revision = 0;
  const apply = () => {
    document.documentElement.dataset.theme = resolveTheme(preference, media.matches);
    document.documentElement.dataset.themePreference = preference;
  };
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(THEME_STORAGE_KEY in changes)) return;
    revision++;
    preference = themePreference(changes[THEME_STORAGE_KEY].newValue);
    apply();
  });
  media.addEventListener('change', apply);
  try {
    const stored = await browser.storage.local.get(THEME_STORAGE_KEY);
    if (revision === 0) preference = themePreference(stored[THEME_STORAGE_KEY]);
  } catch { /* Storage failure must not prevent opening the extension. */ }
  apply();
}

export async function saveTheme(preference: ThemePreference): Promise<void> {
  await browser.storage.local.set({ [THEME_STORAGE_KEY]: themePreference(preference) });
}
