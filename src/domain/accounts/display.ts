import type { Account } from './account.ts';
import type { ProfileMetadata } from '@domain/profile/profileMetadata.ts';
import { truncateNpub } from '@domain/nostr/display.ts';
import { getInitial } from '@utils/format/text.ts';
import { MAX_ACCOUNT_NAME_LENGTH } from '@constants/accounts.ts';

/**
 * Shared identity presentation; remote connection labels are not profile names.
 * A profile name wins; the person's own `label` comes next, for accounts that
 * have no profile name to show.
 */
export function accountDisplay(account: Pick<Account, 'pubkey' | 'name' | 'type'>, profile?: ProfileMetadata | null, label?: string) {
  const profileName = profile?.name || profile?.display_name || '';
  const name = profileName || label ||
    (account.type === 'nip46' ? '' : account.name) || truncateNpub(account.pubkey);
  return { name, hasProfileName: !!profileName, subtitle: profile?.nip05 || truncateNpub(account.pubkey), picture: profile?.picture || null, initial: getInitial(name) };
}

/** A label as stored: trimmed, inner whitespace collapsed, capped. Empty means "no label". */
export function normalizeAccountLabel(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_ACCOUNT_NAME_LENGTH);
}
