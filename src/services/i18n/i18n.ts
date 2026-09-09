import { SUPPORTED_LANGUAGES, DEFAULT_LANG } from '@constants/i18n.ts';
// services/i18n/i18n.ts — Internationalization module
// Flat key-value JSON locale files, {param} interpolation

import type { SupportedLanguage } from '../../domain/i18n/types.ts';
// The real shim, not a third copy of it. Two others existed: this one and the
// one in src/shared/, which silently omitted the Safari storage.session
// polyfill. Both read a bare `chrome` at module load, so importing this module
// anywhere without the extension globals threw before it did anything.
import browser from '../../lib/browser.ts';
const localeCache: Record<string, Record<string, string>> = {};
let currentLang: string = DEFAULT_LANG;
let currentStrings: Record<string, string> = {};
let langWasChosen: boolean = false;

async function loadLocale(lang: string): Promise<Record<string, string>> {
  if (localeCache[lang]) return localeCache[lang];
  try {
    const url = browser.runtime.getURL(`locales/${lang}.json`);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data: Record<string, string> = await resp.json();
    localeCache[lang] = data;
    return data;
  } catch (e) {
    console.warn(`[i18n] Failed to load locale "${lang}":`, e);
    if (lang !== DEFAULT_LANG) return loadLocale(DEFAULT_LANG);
    return {};
  }
}

/**
 * Translate a key with optional parameter interpolation.
 * @param key - Dot-separated key, e.g. "wizard.title"
 * @param params - Replacement map, e.g. { count: 5 }
 * @returns Translated string or the key itself as fallback
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let str = currentStrings[key];
  if (str === undefined) return key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}

/**
 * Initialize i18n: read saved language and load locale strings.
 * Call this in DOMContentLoaded before other setup.
 * @returns The language code that was loaded
 */
export async function initI18n(): Promise<string> {
  try {
    // Try sync first, fall back to local
    let lang: string | undefined;
    try {
      const data = await browser.storage.sync.get(['language']);
      lang = data.language as string | undefined;
    } catch { /* sync unavailable */ }
    if (!lang) {
      try {
        const data = await browser.storage.local.get(['language']);
        lang = data.language as string | undefined;
      } catch { /* local unavailable */ }
    }
    currentLang = lang || DEFAULT_LANG;
    langWasChosen = !!lang;
  } catch {
    currentLang = DEFAULT_LANG;
  }
  currentStrings = await loadLocale(currentLang);
  document.documentElement.lang = currentLang;
  return currentLang;
}

/**
 * Switch language: save preference and reload locale strings.
 * @param lang - Language code, e.g. "es"
 */
export async function setLanguage(lang: string): Promise<void> {
  currentLang = lang;
  langWasChosen = true;
  // Save to both sync and local for reliability
  const saveData = { language: lang };
  await Promise.allSettled([
    browser.storage.sync.set(saveData),
    browser.storage.local.set(saveData),
  ]);
  currentStrings = await loadLocale(lang);
  document.documentElement.lang = lang;
}

/**
 * Get current language code.
 */
export function getLanguage(): string {
  return currentLang;
}

/**
 * Check if a language has been explicitly chosen by the user.
 */
export function isLanguageChosen(): boolean {
  return langWasChosen;
}

/**
 * Get list of supported languages.
 */
export function getSupportedLanguages(): SupportedLanguage[] {
  return SUPPORTED_LANGUAGES;
}
