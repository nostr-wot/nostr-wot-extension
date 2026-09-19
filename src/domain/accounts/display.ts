import type { Account } from './account.ts';
import type { ProfileMetadata } from '@domain/profile/profileMetadata.ts';
import { truncateNpub } from '@domain/nostr/display.ts';
import { getInitial } from '@utils/format/text.ts';

/** Shared identity presentation; remote connection labels are not profile names. */
export function accountDisplay(account: Pick<Account, 'pubkey' | 'name' | 'type'>, profile?: ProfileMetadata | null) {
  const name = profile?.name || profile?.display_name ||
    (account.type === 'nip46' ? '' : account.name) || truncateNpub(account.pubkey);
  return { name, subtitle: profile?.nip05 || truncateNpub(account.pubkey), picture: profile?.picture || null, initial: getInitial(name) };
}
