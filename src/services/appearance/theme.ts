import browser from '@lib/browser.ts';
import { CUSTOM_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from '@constants/appearance.ts';
import { parseCustomTheme, resolveTheme, themePreference, type CustomTheme, type ThemePreference } from '@domain/appearance/theme.ts';

const CSS_KEYS: Record<keyof CustomTheme, string> = {
  bgPage: '--bg-page', bgPageSolid: '--bg-page-solid', bgHtml: '--bg-html',
  bgElevated: '--bg-elevated', surfaceHover: '--surface-hover', inputBg: '--input-bg',
  textHeading: '--text-heading', textBody: '--text-body', textSecondary: '--text-secondary',
  textMuted: '--text-muted', brand: '--brand', brandHover: '--brand-hover',
  textOnBrand: '--text-on-brand', cardBg: '--card-bg', cardBorder: '--card-border',
  controlBorder: '--control-border', success: '--success', error: '--error',
  warning: '--warning', info: '--info',
};

function applyCustomTheme(theme: CustomTheme | null): void {
  for (const cssKey of Object.values(CSS_KEYS)) document.documentElement.style.removeProperty(cssKey);
  if (!theme) return;
  for (const [key, cssKey] of Object.entries(CSS_KEYS) as Array<[keyof CustomTheme, string]>) {
    document.documentElement.style.setProperty(cssKey, theme[key]);
  }
}

export async function initTheme(): Promise<void> {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference: ThemePreference = 'light';
  let custom: CustomTheme | null = null;
  let revision = 0;
  const apply = () => {
    const resolved = resolveTheme(preference, media.matches);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = preference;
    applyCustomTheme(resolved === 'custom' ? custom : null);
  };
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (THEME_STORAGE_KEY in changes) {
      revision++;
      preference = themePreference(changes[THEME_STORAGE_KEY].newValue);
    }
    if (CUSTOM_THEME_STORAGE_KEY in changes) {
      try { custom = parseCustomTheme(changes[CUSTOM_THEME_STORAGE_KEY].newValue); } catch { custom = null; }
    }
    apply();
  });
  media.addEventListener('change', apply);
  try {
    const stored = await browser.storage.local.get([THEME_STORAGE_KEY, CUSTOM_THEME_STORAGE_KEY]);
    if (revision === 0) preference = themePreference(stored[THEME_STORAGE_KEY]);
    try { custom = parseCustomTheme(stored[CUSTOM_THEME_STORAGE_KEY]); } catch { custom = null; }
  } catch { /* Storage failure must not prevent opening the extension. */ }
  apply();
}

export async function saveTheme(preference: ThemePreference): Promise<void> {
  await browser.storage.local.set({ [THEME_STORAGE_KEY]: themePreference(preference) });
}

export async function saveCustomTheme(theme: CustomTheme): Promise<void> {
  const safe = parseCustomTheme(theme);
  await browser.storage.local.set({ [CUSTOM_THEME_STORAGE_KEY]: safe, [THEME_STORAGE_KEY]: 'custom' });
}
