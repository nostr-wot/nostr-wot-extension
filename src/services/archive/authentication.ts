import { archiveRelayUrl } from '@domain/archive/settings.ts';
import { MAX_RELAY_AUTH_CHALLENGE_LENGTH } from '@constants/relays.ts';
import * as kinds from 'nostr-tools/kinds';
import type { SignedEvent, UnsignedEvent } from '../../domain/nostr/types.ts';
import { signEvent } from '../../lib/crypto/nip01.ts';
import type { RelayTransportOptions } from '../relays/transport.ts';
import * as vault from '../vault/vault.ts';
import { archiveAccount } from './state.ts';
import { handleNip46Request, isNip46Connected } from '../signing/remoteSigner.ts';

/** Native Archive authentication is account-specific and never borrows website AUTH grants. */
export async function archiveTransportOptions(
  accountId: string,
  signal?: AbortSignal,
): Promise<RelayTransportOptions> {
  await vault.requireUnlocked();
  const revision = vault.getSessionRevision();
  const account = await archiveAccount(accountId);
  const vaultBacked = !!vault.getAccountById(accountId);
  const assertSession = () => {
    if (signal?.aborted) throw new Error('Archive operation cancelled');
    if (vault.isLocked()) throw new Error('Vault is locked');
    if (
      vault.getSessionRevision() !== revision ||
      (vaultBacked && vault.getAccountById(accountId)?.pubkey !== account.pubkey)
    )
      throw new Error('Archive account session changed');
  };
  assertSession();
  const options: RelayTransportOptions = {
    signal,
    scope: `archive:${accountId}:${revision}:auth`,
    assertSession,
  };
  options.authenticate = async (challenge, relay) => {
    assertSession();
    if (account.readOnly || account.type === 'npub' || account.type === 'external')
      throw new Error('Read-only accounts cannot authenticate to relays');
    if (
      typeof challenge !== 'string' ||
      challenge.length === 0 ||
      challenge.length > MAX_RELAY_AUTH_CHALLENGE_LENGTH
    )
      throw new Error('Invalid relay authentication challenge');
    archiveRelayUrl(relay);
    const event: UnsignedEvent = {
      kind: kinds.ClientAuth,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: account.pubkey,
      content: '',
      tags: [
        ['relay', relay],
        ['challenge', challenge],
      ],
    };
    let signed: SignedEvent;
    if (account.type === 'nip46') {
      if (vault.getActiveAccountId() !== accountId || !isNip46Connected(accountId))
        throw new Error('Connect this account’s remote signer before relay authentication');
      // handleNip46Request checks the active session and verifies the returned exact event.
      signed = (await handleNip46Request(account, 'signEvent', event, 'extension:archive', {
        connectedOnly: true,
      })) as SignedEvent;
    } else {
      signed = await vault.withPrivkey(
        accountId,
        async (privateKey) => {
          assertSession();
          const result = await signEvent(event, privateKey);
          assertSession();
          return result;
        },
        { touchActivity: false },
      );
    }
    assertSession();
    return signed;
  };
  return options;
}
