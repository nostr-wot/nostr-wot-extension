import browser from '@lib/browser.ts';
import { MUTE_LIST_CACHE } from '@constants/relays.ts';
import { cacheKey, type CachedAnswer } from '@services/relays/relayCache.ts';
import type { MuteListRead } from '@domain/mutes/muteList.ts';
import { decryptForAccount } from '@services/signing/localDecryption.ts';

/** Read the shared account cache without opening sockets or prompting a remote signer.
 * Decrypted private entries live only for this operation, never in persisted graphs.
 */
export async function readWotMutes(accountId: string, pubkey: string) {
    const key = cacheKey(MUTE_LIST_CACHE, pubkey);
    const stored = await browser.storage.local.get(key);
    const list = (stored[key] as CachedAnswer<MuteListRead> | undefined)?.value;
    const people = new Set((list?.people || []).filter(pk => /^[0-9a-f]{64}$/i.test(pk)).map(pk => pk.toLowerCase()));
    let status: 'ready' | 'unavailable' | 'private-unavailable' = !list || list.reachable === false ? 'unavailable' : 'ready';
    if (list?.rawContent) {
        try {
            const text = await decryptForAccount(accountId, list.rawContent.includes('?iv=') ? 'nip04' : 'nip44', pubkey, list.rawContent);
            const tags: unknown = JSON.parse(text);
            if (!Array.isArray(tags)) throw new Error('Invalid mute tags');
            for (const tag of tags) {
                if (!Array.isArray(tag) || !tag.every(value => typeof value === 'string')) throw new Error('Invalid mute tag');
                if (tag[0] === 'p' && /^[0-9a-f]{64}$/i.test(tag[1])) people.add(tag[1].toLowerCase());
            }
        } catch { status = 'private-unavailable'; }
    }
    return { people, status, revision: JSON.stringify(stored[key] ?? null) };
}
