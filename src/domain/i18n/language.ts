import type { SupportedLanguage } from './types.ts';

/** Fields needed by a language picker. */
export type Language = Pick<SupportedLanguage, 'code' | 'flag' | 'native' | 'prompt'>;
