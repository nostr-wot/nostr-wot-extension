import type { FetchFn } from '@services/http/types.ts';
import { WOT_ORACLE_TIMEOUT_MS, WOT_MAX_RESPONSE_BYTES } from '@constants/wot.ts';
import { wotPubkey } from '@domain/wot/validation.ts';
import { trustScore } from '@domain/wot/graph.ts';
import type { WotDetails } from '@domain/wot/types.ts';
/** Explicitly configured oracle only: no redirects, cookies, or unbounded bodies. */
export class WotOracle {
    constructor(private base: string, private signal: AbortSignal, private fetchFn: FetchFn = fetch) { }
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
    async details(from: string, to: string): Promise<WotDetails | null> {
        const data = await this.request('distance', { from, to });
        if (!data || data.hops === null)
            return null;
        if (!Number.isInteger(data.hops) || (data.hops as number) < 0 || (data.hops as number) > 100)
            throw new Error('Invalid oracle distance');
        if (data.paths != null && (!Number.isSafeInteger(data.paths) || (data.paths as number) < 0))
            throw new Error('Invalid oracle paths');
        const hops = data.hops as number, paths = (data.paths as number | undefined) ?? null;
        return { hops, paths, score: trustScore(hops, paths) };
    }
    async follows(pubkey: string): Promise<string[]> {
        const data = await this.request('follows', { pubkey });
        return data ? this.keys(data.follows) : [];
    }
    async common(from: string, to: string): Promise<string[]> {
        const data = await this.request('common-follows', { from, to });
        return data ? this.keys(data.common) : [];
    }
    private keys(value: unknown): string[] {
        if (!Array.isArray(value))
            throw new Error('Invalid oracle pubkey list');
        return [...new Set(value.map(wotPubkey))];
    }
    async path(from: string, to: string): Promise<string[] | null> {
        const data = await this.request('path', { from, to });
        if (!data || data.path === null)
            return null;
        const path = this.keys(data.path);
        if (path.length !== (data.path as unknown[]).length || path.length > 101 || path[0] !== from || path.at(-1) !== to)
            throw new Error('Invalid oracle path');
        return path;
    }
    async stats(): Promise<Record<string, unknown>> { return (await this.request('stats')) || {}; }
}
