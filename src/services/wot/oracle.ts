import type { FetchFn } from '@services/http/types.ts';
import { WOT_ORACLE_TIMEOUT_MS, WOT_MAX_RESPONSE_BYTES, WOT_MAX_HOPS, WOT_ORACLE_MAX_HOPS, WOT_ORACLE_FOLLOWS_LIMIT, WOT_ORACLE_MAX_FOLLOW_PAGES } from '@constants/wot.ts';
import { wotPubkey } from '@domain/wot/validation.ts';
import { trustScore } from '@domain/wot/graph.ts';
import type { WotDetails } from '@domain/wot/types.ts';
/**
 * Explicitly configured oracle only: no redirects, cookies, or unbounded bodies.
 *
 * The wire shapes below are nostr-wot-oracle's, taken from that repository's
 * `docs/API.md` table and `src/api/http.rs`, not from this client's assumptions. The
 * two had drifted, and every divergence failed silently rather than loudly:
 *
 * | | this client read | nostr-wot-oracle sends |
 * |---|---|---|
 * | `GET /distance` | `paths` | `path_count` |
 * | `GET /common-follows` | `common` | `common_follows` |
 * | `GET /path` | a path including both endpoints | intermediate pubkeys only |
 * | `GET /follows` | one page, treated as the list | a page plus `total` |
 * | `max_hops` | never sent | accepted, 1..5, server default 3 |
 *
 * A field the oracle does not send reads as `undefined`, so a wrong spelling is not an
 * error: the path bonus was simply absent from every remote score and common follows
 * came back empty. Each of these is pinned by a test in `tests/wot.test.ts`.
 */
export class WotOracle {
    /** Sent on every graph query, so the depth is ours rather than the server's. */
    private readonly maxHops: number;
    /**
     * `maxHops` is the depth this query was asked for, which the caller already uses to
     * discard anything deeper. Sending it means the oracle does not search past the
     * answer we would keep, and that a change to its default cannot move our scores.
     * Clamped to the 1..5 it accepts: a value it rejects is a 400, not a shallow answer,
     * and depth 0 is answerable at depth 1 and filtered by the caller.
     */
    constructor(private base: string, private signal: AbortSignal, private fetchFn: FetchFn = fetch, maxHops: number = WOT_MAX_HOPS) {
        const asked = Number.isFinite(maxHops) ? Math.trunc(maxHops) : WOT_MAX_HOPS;
        this.maxHops = Math.min(Math.max(asked, 1), WOT_ORACLE_MAX_HOPS);
    }
    private async request(path: string, params: Record<string, string> = {}): Promise<Record<string, unknown> | null> {
        const signal = AbortSignal.any([this.signal, AbortSignal.timeout(WOT_ORACLE_TIMEOUT_MS)]);
        const url = new URL(`${this.base}/${path}`);
        for (const [key, value] of Object.entries(params))
            url.searchParams.set(key, value);
        const response = await this.fetchFn(url.href, { signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (response.redirected || response.status >= 300 && response.status < 400) {
            await response.body?.cancel();
            throw new Error('Oracle redirects are not allowed');
        }
        if (response.status === 404) {
            await response.body?.cancel();
            return null;
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`Oracle error: ${response.status}`);
        }
        const reader = response.body?.getReader();
        if (!reader)
            throw new Error('Empty oracle response');
        const chunks: Uint8Array[] = [];
        let size = 0;
        const cancel = () => { void reader.cancel().catch(() => { }); };
        signal.addEventListener('abort', cancel, { once: true });
        try {
            while (true) {
                signal.throwIfAborted();
                const { value, done } = await reader.read();
                signal.throwIfAborted();
                if (done)
                    break;
                size += value.length;
                if (size > WOT_MAX_RESPONSE_BYTES)
                    throw new Error('Oracle response too large');
                chunks.push(value);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.length;
            }
            const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
            if (!data || typeof data !== 'object' || Array.isArray(data))
                throw new Error('Invalid oracle response');
            return data as Record<string, unknown>;
        }
        finally {
            signal.removeEventListener('abort', cancel);
            await reader.cancel().catch(() => { });
        }
    }
    /**
     * `GET /distance`: `from`, `to`, `hops`, `path_count`, `mutual_follow`, optional
     * `bridges` (docs/API.md). The count is `path_count`; this client read `paths`, a
     * field the oracle has never sent, so `trustScore` was handed `null` every time and
     * every remote score quietly lost its path bonus.
     *
     * `hops: null` is the oracle saying no route was found within the depth it searched,
     * which its documentation is careful is "not proof of no connection across Nostr".
     * It stays absent rather than becoming a zero score.
     *
     * `mutual_follow` and `bridges` are sent but not read: neither has a place in
     * `WotDetails`, and giving either a weight here would be inventing a number.
     */
    async details(from: string, to: string): Promise<WotDetails | null> {
        const data = await this.request('distance', { from, to, max_hops: String(this.maxHops) });
        if (!data || data.hops === null)
            return null;
        if (!Number.isInteger(data.hops) || (data.hops as number) < 0 || (data.hops as number) > 100)
            throw new Error('Invalid oracle distance');
        const hops = data.hops as number, paths = this.pathCount(data.path_count);
        return { hops, paths, score: trustScore(hops, paths) };
    }
    /**
     * `path_count` from `GET /distance`. docs/API.md: "Counts saturate at the maximum
     * unsigned 64-bit integer rather than overflowing", and that maximum is well past
     * `Number.MAX_SAFE_INTEGER`, so refusing an unsafe integer would refuse a documented
     * answer. It is clamped instead, which costs nothing: `trustScore` caps the bonus at
     * `maxPathBonus` long before a count gets that large. Absent is honest ("no count"),
     * and the curve reads it as no evidence. Present but not a count is a broken server.
     */
    private pathCount(value: unknown): number | null {
        if (value == null)
            return null;
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
            throw new Error('Invalid oracle path count');
        return Math.min(value, Number.MAX_SAFE_INTEGER);
    }
    /**
     * `GET /follows`: `pubkey`, `follows`, `total`, with `limit` defaulting to 500 and
     * capped at 5000 (docs/API.md, and `get_follows` in src/api/http.rs). One request
     * therefore answers with a page and its full count, not with a follow list. Asking
     * without a limit and returning what came back truncated every account past 500
     * follows to a prefix that looked complete, which then silently shrank the common
     * follows computed from it. The limit is explicit and the pages are walked instead.
     */
    async follows(pubkey: string): Promise<string[]> {
        const all = new Set<string>();
        let offset = 0;
        for (let page = 0; page < WOT_ORACLE_MAX_FOLLOW_PAGES; page++) {
            const data = await this.request('follows', { pubkey, offset: String(offset), limit: String(WOT_ORACLE_FOLLOWS_LIMIT) });
            if (!data)
                break;
            for (const key of this.keys(data.follows))
                all.add(key);
            // The page's own length, not the deduplicated count, is what the next offset
            // is measured in.
            const returned = (data.follows as unknown[]).length;
            offset += returned;
            // A server may answer with fewer rows than asked for, so `total` decides
            // whether to continue. An empty page ends the walk regardless: one that
            // kept claiming a larger total would otherwise spin up to the page bound.
            if (!returned || !Number.isSafeInteger(data.total) || offset >= (data.total as number))
                break;
        }
        return [...all];
    }
    /** `GET /common-follows`: the field is `common_follows` (docs/API.md), not `common`. */
    async common(from: string, to: string): Promise<string[]> {
        const data = await this.request('common-follows', { from, to });
        return data ? this.keys(data.common_follows) : [];
    }
    private keys(value: unknown): string[] {
        if (!Array.isArray(value))
            throw new Error('Invalid oracle pubkey list');
        return [...new Set(value.map(wotPubkey))];
    }
    /**
     * `GET /path`: `path` is "intermediate pubkeys only, or null", and the oracle
     * "returns an empty intermediate list for self/direct paths" (docs/API.md). This
     * client required `path[0] === from` and `path.at(-1) === to`, which no answer from
     * this oracle can satisfy, so every remote path query threw and every caller that
     * depended on one, including the mute-aware scoring path, got nothing.
     *
     * Both endpoints are added back, so the rest of the service sees the same
     * root-first, target-last shape `graphPath` returns for a local answer. An empty
     * intermediate list is a valid answer, not an absent one.
     */
    async path(from: string, to: string): Promise<string[] | null> {
        const data = await this.request('path', { from, to, max_hops: String(this.maxHops) });
        if (!data || data.path === null)
            return null;
        const inner = this.keys(data.path);
        // At most WOT_ORACLE_MAX_HOPS hops is at most that many minus one intermediates.
        // A longer list, a repeated hop, or an endpoint inside the middle is a server we
        // are not talking to, and is refused rather than scored.
        if (inner.length !== (data.path as unknown[]).length || inner.length > WOT_ORACLE_MAX_HOPS - 1
            || inner.includes(from) || inner.includes(to))
            throw new Error('Invalid oracle path');
        return from === to ? [from] : [from, ...inner, to];
    }
    async stats(): Promise<Record<string, unknown>> { return (await this.request('stats')) || {}; }
}
