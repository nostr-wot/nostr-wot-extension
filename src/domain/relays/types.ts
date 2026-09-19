import type { SignedEvent } from '../nostr/types.ts';

// ── Relay / liveQuery ──

export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  '#e'?: string[];
  '#p'?: string[];
  since?: number;
  until?: number;
  limit?: number;
}

export type LiveEvent =
  | { type: 'event';     event: SignedEvent; source: 'local' | 'relay'; relay?: string }
  | { type: 'update';    event: SignedEvent; supersedes: string }
  | { type: 'delete';    eventId: string }
  | { type: 'eose';      relay: string }
  | { type: 'exhausted' };

export interface LiveQueryOptions {
  /** Dedicated graph storage supplies its own verified public-list cache. */
  skipLocalCache?: boolean;
  closeOnExhaust?: boolean;
  cache?: boolean;
  signal?: AbortSignal;
  /** Override the relay deadline for deterministic transport tests. */
  _timeoutMs?: number;
  /** Injected for testing — defaults to `(url) => new WebSocket(url)` */
  _createSocket?: (url: string) => WebSocket;
}

export interface RelayListRead {
  pubkey: string;
  event: SignedEvent | null;
  reachable: boolean;
}
