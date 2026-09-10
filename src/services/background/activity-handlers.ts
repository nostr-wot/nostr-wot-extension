import { ACTIVITY_ENTRY_MAX_BYTES, ACTIVITY_LOG_MAX_BYTES, ACTIVITY_LOG_GLOBAL_MAX, ACTIVITY_MAX_CIPHERTEXT_LENGTH } from '@constants/activity.ts';
/**
 * Activity log handlers: log, retrieve, and clear the activity log.
 * @module services/background/activity-handlers
 */

import { readPrivateCache, writePrivateCache, removePrivateCache } from '../storage/private-cache.ts';
import { AsyncLock } from '@utils/asyncLock.ts';
const activityWrites = new AsyncLock();
import * as vault from '../vault/vault.ts';
import { decryptForAccount } from '../signing/localDecryption.ts';
import { activityEntryKey, activityEncryption, filterActivityEntries, type ActivityEntry, type ActivityLogInput } from '../../domain/activity/activity.ts';
import { verifyEvent } from '../../lib/crypto/nip01.ts';
import type { SignedEvent } from '../../domain/nostr/types.ts';
import { config, type HandlerFn } from './state.ts';
import { ACTIVITY_LOG_MAX_PER_DOMAIN } from '@constants/activity.ts';

// ── Activity Log ──

export async function logActivity(entry: ActivityLogInput): Promise<void> {
    try {
        if (vault.isLocked()) return;
        await activityWrites.run(async () => {
        const log = await readPrivateCache<ActivityEntry[]>('activityLog') || [];
        const record: ActivityEntry = {
            timestamp: Date.now(),
            domain: entry.domain,
            method: entry.method,
            kind: entry.kind ?? null,
            decision: entry.decision,
            pubkey: entry.pubkey !== undefined ? entry.pubkey : config.myPubkey || null,
            ...(entry.event && { event: entry.event }),
            ...(entry.theirPubkey && { theirPubkey: entry.theirPubkey }),
            ...(entry.ciphertext && entry.ciphertext.length <= ACTIVITY_MAX_CIPHERTEXT_LENGTH && { ciphertext: entry.ciphertext }),
        };
        if (new TextEncoder().encode(JSON.stringify(record)).length > ACTIVITY_ENTRY_MAX_BYTES) {
            delete record.event;
            delete record.ciphertext;
        }
        log.unshift(record);
        // Bound retention across domains as well as within each domain.
        const domainCounts = new Map<string, number>();
        let bytes = 2;
        let count = 0;
        const trimmed = log.filter((e) => {
            const d = (e.domain as string) || '?';
            const size = new TextEncoder().encode(JSON.stringify(e)).length + 1;
            const domainCount = domainCounts.get(d) || 0;
            if (size > ACTIVITY_ENTRY_MAX_BYTES || bytes + size > ACTIVITY_LOG_MAX_BYTES || count >= ACTIVITY_LOG_GLOBAL_MAX || domainCount >= ACTIVITY_LOG_MAX_PER_DOMAIN) return false;
            domainCounts.set(d, domainCount + 1);
            bytes += size;
            count++;
            return true;
        });
        await writePrivateCache('activityLog', trimmed);
        });
    } catch { /* ignored */ }
}

// ── Handler Map ──

export const handlers = new Map<string, HandlerFn>([
    ['activity_decrypt', async (params) => {
        await vault.whenStartupUnlockSettled();
        if (vault.isLocked()) throw new Error('Vault is locked');
        const stored = await readPrivateCache<ActivityEntry[]>('activityLog');
        const entry = (stored || []).find((item: ActivityEntry) => activityEntryKey(item) === params.entryKey) as ActivityEntry | undefined;
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
        await vault.whenStartupUnlockSettled();
        return await readPrivateCache<ActivityEntry[]>('activityLog') || [];
    }],

    ['clearActivityLog', async (params) => {
        return activityWrites.run(async () => {
        const hasFilter = params.domain || params.accountPubkey || params.typeFilter || params.pubkeyFilter;
        if (!hasFilter) {
            await removePrivateCache('activityLog');
        } else {
            const allLog = await readPrivateCache<ActivityEntry[]>('activityLog') || [];
            const selected = new Set(filterActivityEntries(allLog, {
                account: params.accountPubkey as string | undefined,
                domain: params.domain as string | undefined,
                type: params.typeFilter as string | undefined,
                pubkeyQuery: params.pubkeyFilter as string | undefined,
            }));
            const kept = allLog.filter(entry => !selected.has(entry));
            await writePrivateCache('activityLog', kept);
        }
        return { ok: true };
        });
    }],
]);

vault.onUnlock(async () => {
  try { await readPrivateCache('activityLog'); } catch { /* Leave damaged ciphertext untouched. */ }
});
