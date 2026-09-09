import type { SupportedLanguage } from '@domain/i18n/types.ts';

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', name: 'English', native: 'English', flag: '\u{1F1FA}\u{1F1F8}', prompt: 'Select your language' },
  { code: 'es', name: 'Spanish', native: 'Espa\u00f1ol', flag: '\u{1F1EA}\u{1F1F8}', prompt: 'Selecciona tu idioma' },
  { code: 'pt', name: 'Portuguese', native: 'Portugu\u00eas', flag: '\u{1F1E7}\u{1F1F7}', prompt: 'Selecione seu idioma' },
  { code: 'de', name: 'German', native: 'Deutsch', flag: '\u{1F1E9}\u{1F1EA}', prompt: 'W\u00e4hle deine Sprache' },
  { code: 'fr', name: 'French', native: 'Fran\u00e7ais', flag: '\u{1F1EB}\u{1F1F7}', prompt: 'Choisissez votre langue' },
  { code: 'it', name: 'Italian', native: 'Italiano', flag: '\u{1F1EE}\u{1F1F9}', prompt: 'Seleziona la tua lingua' }
];

export const DEFAULT_LANG = 'en';
