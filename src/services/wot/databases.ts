import { publicListSummary } from './public-lists.ts';
import browser from '@lib/browser.ts';
import { WOT_GRAPH_PREFIX } from '@constants/wot.ts';
import { snapshotKeys, snapshotSummary } from './snapshots.ts';
import { accountDisplay } from '@domain/accounts/display.ts';
import { truncateNpub } from '@domain/nostr/display.ts';
import type { Account } from '@domain/accounts/account.ts';
import type { WotDatabase, WotDatabaseSummary } from '@domain/wot/types.ts';

/** Only WoT snapshots: never return unrelated vault or wallet storage to the UI. */
export async function getWotDatabases(): Promise<WotDatabaseSummary> {
    const stored = await browser.storage.local.get('accounts');
    const accounts = (stored.accounts || []) as Account[];
    const databases: WotDatabase[] = [];
    for (const key of await snapshotKeys(accounts.map(a=>a.id))) {
        const summary = await snapshotSummary(key);
        if (!summary) continue;
        const accountId = key.slice(WOT_GRAPH_PREFIX.length);
        const account = accounts.find(a=>a.id===accountId && a.pubkey===summary.root);
        databases.push({canSync:!!account,truncated:summary.truncated,missingFollowLists:summary.missingFollowLists,accountId,pubkey:summary.root,name:account ? accountDisplay(account).name : truncateNpub(summary.root),bytes:summary.bytes,estimated:true,people:summary.people,authors:summary.authors,updatedAt:summary.updatedAt});
    }
    return { sharedCache: await publicListSummary(), databases, accounts: new Set(databases.map(d => d.accountId)).size, bytes: databases.reduce((sum, d) => sum + d.bytes, 0), estimated: databases.some(d => d.estimated) };
}
