import {
  ENCRYPTED_PRIVATE_KEY_PREFIX,
  PRIVATE_KEY_PREFIX,
  PRIVATE_KEY_HEX_PATTERN,
  IMPORT_MNEMONIC_WORD_COUNTS,
} from '@constants/accounts.ts';
import { countWords } from '@utils/text.ts';

export type ImportType = 'ncryptsec' | 'nsec' | 'mnemonic' | null;

/**
 * Classify pasted key material for import routing and UI hints.
 * A recognized format is not proof of a valid checksum, key or mnemonic;
 * the account/crypto services must still validate before accepting it.
 */
export function detectImportType(value: string): ImportType {
  const input = value.trim();
  if (input.startsWith(ENCRYPTED_PRIVATE_KEY_PREFIX)) return 'ncryptsec';
  if (input.startsWith(PRIVATE_KEY_PREFIX) || PRIVATE_KEY_HEX_PATTERN.test(input)) return 'nsec';
  if (IMPORT_MNEMONIC_WORD_COUNTS.includes(countWords(input))) return 'mnemonic';
  return null;
}
