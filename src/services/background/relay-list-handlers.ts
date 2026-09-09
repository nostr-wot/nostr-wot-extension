import browser from '../../lib/browser.ts';
import * as vault from '../vault/vault.ts';
import { readPublishedEvent } from '../relays/readPublishedEvent.ts';
import type { RelayListRead } from '@domain/relays/types.ts';

import { type HandlerFn } from './state.ts';
import { DEFAULT_RELAYS } from '@constants/relays.ts';

/** One finite, verified NIP-65 discovery; exhausted sockets are always closed. */
export async function fetchRelayList(pubkey: string, relays: string[]): Promise<RelayListRead> {
  return readPublishedEvent(pubkey, 10002, relays);
}

export const handlers = new Map<string, HandlerFn>([
  ['getMyRelayList', async () => {
    await vault.whenStartupUnlockSettled();
    const local = await browser.storage.local.get(['accounts', 'activeAccountId']);
    const accounts = (local.accounts || []) as { id: string; pubkey: string }[];
    const selected = accounts.find(account => account.id === local.activeAccountId) || accounts[0];
    const pubkey = selected?.pubkey || (accounts.length === 0 ? vault.getActivePubkey() : null);
    if (!pubkey) throw new Error('No active account');
    const stored = await browser.storage.sync.get('relays');
    const configured = String(stored.relays || '').split(',').map(s => s.trim()).filter(Boolean);
    return fetchRelayList(pubkey, [...configured, ...DEFAULT_RELAYS]);
  }],
]);
