import { parseNosskeyAccount } from '@nostr-wot/identity/vault';
import { parsePasskeyBackup } from './passkey.ts';

/** Recognize only validated backups; never guess a key derivation from arbitrary JSON. */
export function detectRecoveryBackup(text: string): 'vault' | 'account' | null {
  try { parsePasskeyBackup(text); return 'vault'; } catch { /* Try the supported account backup. */ }
  try { parseNosskeyAccount(text); return 'account'; } catch { return null; }
}
