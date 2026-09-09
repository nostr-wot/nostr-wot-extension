import { ACTIVITY_MAX_CIPHERTEXT_LENGTH } from '@constants/activity.ts';
/**
 * Activity log handlers: log, retrieve, and clear the activity log.
 * @module services/background/activity-handlers
 */

import browser from '../../lib/browser.ts';
import * as vault from '../vault/vault.ts';
import { decryptForAccount } from '../signing/signer.ts';
import {
  activityEntryKey,
  activityEncryption,
  filterActivityEntries,
  type ActivityEntry,
  type ActivityLogInput,
} from '../../domain/activity/activity.ts';
import { verifyEvent } from '../../lib/crypto/nip01.ts';
import type { SignedEvent } from '../../domain/nostr/types.ts';
import { config, type HandlerFn } from './state.ts';
import { ACTIVITY_LOG_MAX_PER_DOMAIN } from '@constants/activity.ts';

// ── Activity Log ──

export async function logActivity(entry: ActivityLogInput): Promise<void> {
    try {
        const data = await browser.storage.local.get(['activityLog']) as Record<string, ActivityEntry[]>;
        const log = data.activityLog || [];
        log.unshift({
            timestamp: Date.now(),
            domain: entry.domain,
            method: entry.method,
            kind: entry.kind ?? null,
            decision: entry.decision,
            pubkey: entry.pubkey !== undefined ? entry.pubkey : config.myPubkey || null,
            ...(entry.event && { event: entry.event }),
            ...(entry.theirPubkey && { theirPubkey: entry.theirPubkey }),
            ...(entry.ciphertext && entry.ciphertext.length <= ACTIVITY_MAX_CIPHERTEXT_LENGTH && { ciphertext: entry.ciphertext }),
        });
        // Keep max 200 entries per domain
        const domainCounts: Record<string, number> = {};
        const trimmed = log.filter((e) => {
            const d = (e.domain as string) || '?';
            domainCounts[d] = (domainCounts[d] || 0) + 1;
            return domainCounts[d] <= ACTIVITY_LOG_MAX_PER_DOMAIN;
        });
        await browser.storage.local.set({ activityLog: trimmed });
    } catch { /* ignored */ }
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['activity_decrypt', async (params) => {
        await vault.whenStartupUnlockSettled();
        if (vault.isLocked()) throw new Error('Vault is locked');
        const stored = await browser.storage.local.get('activityLog');
        const entry = ((stored.activityLog || []) as ActivityEntry[]).find((item: ActivityEntry) => activityEntryKey(item) === params.entryKey) as ActivityEntry | undefined;
        if (!entry) throw new Error('This activity entry is no longer available');
        const encrypted = activityEncryption(entry);
        if (!encrypted) throw new Error('No encrypted content was saved for this entry');
        const account = vault.listAccounts().find(item => item.pubkey === encrypted.accountPubkey);
        if (!account) throw new Error('The account key for this entry is no longer on this device');
        const peer = encrypted.peerPubkey || (typeof params.peerPubkey === 'string' ? params.peerPubkey : '');
        let plaintext = await decryptForAccount(account.id, encrypted.scheme, peer, encrypted.ciphertext);
        // Gift wraps contain a signed NIP-59 seal. Reuse the decoder for its
        // second layer, but authenticate the seal before trusting its author.
        if ((entry.event?.kind === 1059 || entry.event?.kind === 21059)) {
            let seal: SignedEvent | null = null;
            try { seal = JSON.parse(plaintext); } catch { /* not a seal */ }
            if (seal?.kind === 13) {
                if (!(await verifyEvent(seal))) throw new Error('Invalid sealed event signature');
                plaintext = await decryptForAccount(account.id, 'nip44', seal.pubkey, seal.content);
            }
        }
        return { plaintext };
    }],

    ['getActivityLog', async () => {
        const logData = await browser.storage.local.get(['activityLog']) as Record<string, unknown[]>;
        return logData.activityLog || [];
    }],

    ['clearActivityLog', async (params) => {
        const hasFilter = params.domain || params.accountPubkey || params.typeFilter || params.pubkeyFilter;
        if (!hasFilter) {
            await browser.storage.local.remove('activityLog');
        } else {
            const allLog = ((await browser.storage.local.get(['activityLog'])) as Record<string, ActivityEntry[]>).activityLog || [];
            const selected = new Set(filterActivityEntries(allLog, {
                account: params.accountPubkey as string | undefined,
                domain: params.domain as string | undefined,
                type: params.typeFilter as string | undefined,
                pubkeyQuery: params.pubkeyFilter as string | undefined,
            }));
            const kept = allLog.filter(entry => !selected.has(entry));
            await browser.storage.local.set({ activityLog: kept });
        }
        return { ok: true };
    }],
]);
