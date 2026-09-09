/**
 * Activity log handlers: log, retrieve, and clear the activity log.
 * @module services/background/activity-handlers
 */

import browser from '../../lib/browser.ts';
import * as vault from '../vault/vault.ts';
import { decryptForAccount } from '../signing/signer.ts';
import { activityEntryKey, activityEncryption, type ActivityEntry as DisplayEntry } from '../../domain/activity/activity.ts';
import { verifyEvent } from '../../lib/crypto/nip01.ts';
import type { SignedEvent } from '../../domain/nostr/types.ts';
import { config, type HandlerFn } from './state.ts';
import { ACTIVITY_LOG_MAX_PER_DOMAIN } from '../../domain/activity/constants.ts';

// ── Types ──

interface ActivityEntry {
    pubkey?: string | null;
    domain?: string;
    method: string;
    decision: string;
    kind?: number;
    event?: Record<string, unknown>;
    theirPubkey?: string;
    ciphertext?: string;
}

interface StoredActivityEntry {
    timestamp: number;
    domain?: string;
    method: string;
    kind?: number | null;
    decision: string;
    pubkey?: string | null;
    event?: { tags?: string[][] } & Record<string, unknown>;
    theirPubkey?: string;
    ciphertext?: string;
}

// ── Activity Log ──

export async function logActivity(entry: ActivityEntry): Promise<void> {
    try {
        const data = await browser.storage.local.get(['activityLog']) as Record<string, Array<Record<string, unknown>>>;
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
            ...(entry.ciphertext && entry.ciphertext.length <= 131072 && { ciphertext: entry.ciphertext }),
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
        const entry = ((stored.activityLog || []) as DisplayEntry[]).find((item: DisplayEntry) => activityEntryKey(item) === params.entryKey) as DisplayEntry | undefined;
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
            const allLog = ((await browser.storage.local.get(['activityLog'])) as Record<string, StoredActivityEntry[]>).activityLog || [];
            const typeMethods: Record<string, string[]> = {
                signEvent: ['signEvent'], getPublicKey: ['getPublicKey'],
                encrypt: ['nip04Encrypt', 'nip44Encrypt'], decrypt: ['nip04Decrypt', 'nip44Decrypt'],
                nip04Encrypt: ['nip04Encrypt'], nip04Decrypt: ['nip04Decrypt'],
                nip44Encrypt: ['nip44Encrypt'], nip44Decrypt: ['nip44Decrypt'],
            };
            const kept = allLog.filter((e: StoredActivityEntry) => {
                if (params.accountPubkey && e.pubkey !== params.accountPubkey) return true;
                if (params.domain && e.domain !== params.domain) return true;
                if (params.typeFilter) {
                    const methods = typeMethods[params.typeFilter as string];
                    if (methods && !methods.includes(e.method)) return true;
                }
                if (params.pubkeyFilter) {
                    const q = (params.pubkeyFilter as string).toLowerCase();
                    let matches = false;
                    if (e.theirPubkey && e.theirPubkey.toLowerCase().includes(q)) matches = true;
                    if (!matches && e.event?.tags) {
                        for (const tag of e.event.tags) {
                            if (tag[0] === 'p' && tag[1] && tag[1].toLowerCase().includes(q)) { matches = true; break; }
                        }
                    }
                    if (!matches) return true;
                }
                return false;
            });
            await browser.storage.local.set({ activityLog: kept });
        }
        return { ok: true };
    }],
]);
