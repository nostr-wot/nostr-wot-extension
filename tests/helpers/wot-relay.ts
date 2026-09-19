import type { SignedEvent } from '../../src/domain/nostr/types.ts';
export function relaySocket(events: SignedEvent[], fail = false) {
    let calls = 0, closed = 0;
    const requests: string[][] = [];
    const filtersSeen: Array<Array<{authors?:string[];kinds?:number[];since?:number}>> = [];
    class Socket {
        onopen: (() => void) | null = null;
        onmessage: ((e: {
            data: string;
        }) => void) | null = null;
        onerror: (() => void) | null = null;
        onclose: (() => void) | null = null;
        constructor() { calls++; queueMicrotask(() => this.onopen?.()); }
        send(raw: string) {
            const [type, id, ...filters] = JSON.parse(raw);
            if (type !== 'REQ') return;
            filtersSeen.push(filters);
            requests.push([...new Set<string>(filters.flatMap((filter: {authors?:string[]})=>filter.authors || []))]);
            queueMicrotask(() => {
                if (fail) {
                    this.onerror?.();
                    return;
                }
                for (const event of events)
                    if (filters.some((filter: {authors?:string[];kinds?:number[];since?:number}) => (!filter.authors || filter.authors.includes(event.pubkey)) && (!filter.kinds || filter.kinds.includes(event.kind)) && (filter.since === undefined || event.created_at >= filter.since)))
                        this.onmessage?.({ data: JSON.stringify(['EVENT', id, event]) });
                this.onmessage?.({ data: JSON.stringify(['EOSE', id]) });
            });
        }
        close() { closed++; }
    }
    globalThis.WebSocket = Socket as unknown as typeof WebSocket;
    return () => ({ calls, closed, requests, filters:filtersSeen });
}
