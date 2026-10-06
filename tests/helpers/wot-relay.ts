import type { SignedEvent } from '../../src/domain/nostr/types.ts';
const activeSockets = new Set<{ close(): void }>();
export function disconnectRelaySockets() {
    for (const socket of [...activeSockets]) socket.close();
    activeSockets.clear();
}
export function relaySocket(events: SignedEvent[], fail = false) {
    disconnectRelaySockets();
    let calls = 0, closed = 0, subscriptionsClosed = 0;
    const requests: string[][] = [];
    const filtersSeen: Array<Array<{authors?:string[];kinds?:number[];since?:number}>> = [];
    class Socket {
        onopen: (() => void) | null = null;
        onmessage: ((e: {
            data: string;
        }) => void) | null = null;
        onerror: (() => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        readyState = 0;
        constructor() { calls++; activeSockets.add(this); queueMicrotask(() => { if (this.readyState !== 3) { this.readyState = 1; this.onopen?.(); } }); }
        send(raw: string) {
            const [type, id, ...filters] = JSON.parse(raw);
            if (type === 'CLOSE') { subscriptionsClosed++; return; }
            if (type !== 'REQ') return;
            filtersSeen.push(filters);
            requests.push([...new Set<string>(filters.flatMap((filter: {authors?:string[]})=>filter.authors || []))]);
            queueMicrotask(() => {
                if (this.readyState !== 1) return;
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
        close() {
            if (this.readyState === 3) return;
            this.readyState = 3; closed++; activeSockets.delete(this);
            this.onclose?.({ reason: 'Test relay disconnected' } as CloseEvent);
        }
    }
    globalThis.WebSocket = Socket as unknown as typeof WebSocket;
    return () => ({ calls, closed, subscriptionsClosed, requests, filters:filtersSeen });
}
