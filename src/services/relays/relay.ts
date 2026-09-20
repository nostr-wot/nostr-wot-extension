import { RELAY_TIMEOUT_MS } from '@constants/relays.ts';
/**
 * liveQuery — streaming relay utility for progressive profile loading.
 *
 * Async generator that yields LiveEvent items as they arrive from
 * local cache and relay WebSocket connections.
 * @module services/relays/relay
 */

import browser from '@lib/browser.ts';
import { verifyEvent } from '../../lib/crypto/nip01.ts';
import type { SignedEvent } from '../../domain/nostr/types.ts';
import type { NostrFilter, LiveEvent, LiveQueryOptions } from '../../domain/relays/types.ts';

// ── Helpers ──

export function isReplaceable(kind: number): boolean {
  return kind === 0 || kind === 3 ||
    (kind >= 10000 && kind <= 19999) ||
    (kind >= 30000 && kind <= 39999);
}

/** NIP-01 replacement ordering, shared by transport and graph ingestion. */
export function isNewerReplaceable(
  candidate: Pick<SignedEvent, 'created_at' | 'id'>,
  current: Pick<SignedEvent, 'created_at' | 'id'>,
): boolean {
  return candidate.created_at > current.created_at ||
    (candidate.created_at === current.created_at && candidate.id < current.id);
}

export function replaceableKey(kind: number, pubkey: string): string {
  return `nostr_r_${kind}_${pubkey}`;
}

export function generateSubId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return 'lq' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// ── Local cache ──

export async function readLocalCache(filters: NostrFilter[]): Promise<SignedEvent[]> {
  const results: SignedEvent[] = [];
  const keys: string[] = [];

  for (const f of filters) {
    if (!f.kinds || !f.authors) continue;
    for (const kind of f.kinds) {
      if (!isReplaceable(kind)) continue;
      for (const author of f.authors) {
        keys.push(replaceableKey(kind, author));
      }
    }
  }

  if (keys.length === 0) return results;

  const data = await browser.storage.local.get(keys) as Record<string, SignedEvent | undefined>;
  for (const key of keys) {
    const ev = data[key];
    // Signature-verify on read as well as on write: storage may hold entries
    // written before verification existed, so never surface unverified data.
    if (ev && ev.id && ev.sig && await verifyEvent(ev)) results.push(ev);
  }
  return results;
}

export async function writeLocalCache(event: SignedEvent): Promise<void> {
  if (!isReplaceable(event.kind)) return;
  // Never persist an event whose id/signature don't check out.
  if (!(await verifyEvent(event))) return;
  const key = replaceableKey(event.kind, event.pubkey);
  await browser.storage.local.set({ [key]: event });
}

// ── Async queue for bridging WebSocket callbacks → async generator ──

interface AsyncQueue<T> {
  push: (item: T) => void;
  pull: () => Promise<T>;
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const pending: T[] = [];
  let resolveNext: ((v: T) => void) | null = null;

  return {
    push(item: T) {
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r(item);
      } else {
        pending.push(item);
      }
    },
    pull(): Promise<T> {
      if (pending.length > 0) return Promise.resolve(pending.shift()!);
      return new Promise(r => { resolveNext = r; });
    },
  };
}

export async function* liveQuery(
  filters: NostrFilter[],
  relays: string[],
  options: LiveQueryOptions = {},
): AsyncGenerator<LiveEvent> {
  const seenIds = new Set<string>();
  // Exact serialized signed payload, never an untrusted claimed ID. Keep only
  // in-flight work; accepted IDs provide the bounded-by-results dedup thereafter.
  const verifying = new Map<string, Promise<boolean>>();
  let stopped = false;
  const cleanup: (() => void)[] = [];
  const bestReplaceable = new Map<string, { event: SignedEvent; emittedId: string }>();
  let eoseCount = 0;
  const totalRelays = relays.length;
  const queue = createAsyncQueue<LiveEvent | { type: '_done' }>();
  const createSocket = options._createSocket || ((url: string) => new WebSocket(url));

  function checkExhausted() {
    if (eoseCount >= totalRelays) {
      queue.push({ type: 'exhausted' });
    }
  }

  async function processEvent(event: SignedEvent, relay: string) {
    // Dedup by event ID
    if (stopped || seenIds.has(event.id)) return;

    // Drop forged events: relays are untrusted, so every inbound event must
    // pass schnorr signature + id verification before it is accepted,
    // yielded, or cached. Verify BEFORE marking the id as seen so a forged
    // event can't shadow a later legitimate one with the same id.
    const payload = JSON.stringify([event.id, event.sig, event.pubkey,
      event.created_at, event.kind, event.tags, event.content]);
    let verification = verifying.get(payload);
    if (!verification) {
      verification = verifyEvent(event);
      verifying.set(payload, verification);
      void verification.finally(() => {
        if (verifying.get(payload) === verification) verifying.delete(payload);
      });
    }
    if (!(await verification) || stopped || seenIds.has(event.id)) return;
    seenIds.add(event.id);

    // Kind 5 deletion
    if (event.kind === 5) {
      for (const tag of event.tags) {
        if (tag[0] === 'e') {
          queue.push({ type: 'delete', eventId: tag[1] });
        }
      }
      return;
    }

    if (isReplaceable(event.kind)) {
      const rKey = replaceableKey(event.kind, event.pubkey);
      const existing = bestReplaceable.get(rKey);

      if (existing) {
        if (isNewerReplaceable(event, existing.event)) {
          const supersedes = existing.emittedId;
          bestReplaceable.set(rKey, { event, emittedId: event.id });
          queue.push({ type: 'update', event, supersedes });
        }
        // Older or equal — skip
        return;
      }

      bestReplaceable.set(rKey, { event, emittedId: event.id });
    }

    queue.push({ type: 'event', event, source: 'relay', relay });

    if (options.cache) {
      writeLocalCache(event).catch(() => {});
    }
  }

  const abort = () => {
    stopped = true;
    for (const dispose of cleanup) dispose();
    queue.push({ type: '_done' });
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (options.signal?.aborted) return;
    // Phase 1: Local cache
    const cached = options.skipLocalCache ? [] : await readLocalCache(filters);
    if (stopped) return;
    for (const event of cached) {
      if (stopped) return;
      seenIds.add(event.id);
      if (isReplaceable(event.kind)) {
        const rKey = replaceableKey(event.kind, event.pubkey);
        bestReplaceable.set(rKey, { event, emittedId: event.id });
      }
      yield { type: 'event', event, source: 'local' };
    }

    if (stopped) return;
    // Phase 2: Relay connections
    if (totalRelays === 0) {
      yield { type: 'exhausted' };
      return;
    }

    const subId = generateSubId();

    for (const relay of relays) {
      let ws: WebSocket;
      try {
        ws = createSocket(relay);
      } catch {
        eoseCount++;
        checkExhausted();
        continue;
      }

      let settled = false;
      let accepting = true;
      let msgChain: Promise<void> = Promise.resolve();
      const settleRelay = () => {
        if (settled || stopped) return;
        settled = true;
        clearTimeout(timer);
        eoseCount++;
        checkExhausted();
      };
      // Stop receiving first, then drain events already accepted for verification.
      // Errors/close/timeouts must obey the same ordering as EOSE.
      const finish = () => {
        if (!accepting) return;
        accepting = false;
        clearTimeout(timer);
        try { ws.close(); } catch { /* ignore */ }
        void msgChain.then(settleRelay);
      };
      const timer = setTimeout(finish, options._timeoutMs ?? RELAY_TIMEOUT_MS);
      cleanup.push(() => {
        accepting = false;
        clearTimeout(timer);
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        try { ws.close(); } catch { /* ignore */ }
      });
      ws.onopen = () => {
        if (!accepting || stopped) return;
        try { ws.send(JSON.stringify(['REQ', subId, ...filters])); }
        catch { finish(); }
      };
      ws.onmessage = (msg: MessageEvent) => {
        if (!accepting || stopped) return;
        let data: unknown[];
        try {
          const parsed: unknown = JSON.parse(typeof msg.data === 'string' ? msg.data : '');
          if (!Array.isArray(parsed) || parsed[1] !== subId) return;
          data = parsed;
        } catch { return; }
        if (data[0] === 'EVENT' && data[2]) {
          msgChain = msgChain.then(async () => {
            try { await processEvent(data[2] as SignedEvent, relay); }
            catch { /* malformed event */ }
          });
        } else if (data[0] === 'EOSE' || data[0] === 'CLOSED') {
          if (data[0] === 'EOSE') {
            msgChain = msgChain.then(() => {
              if (!stopped) queue.push({ type: 'eose', relay });
            });
          }
          finish();
        }
      };
      ws.onerror = finish;
      ws.onclose = finish;
    }

    // Consume queue
    while (!stopped) {
      const item = await queue.pull();
      if (stopped || item.type === '_done') return;
      const liveEvent = item as LiveEvent;
      yield liveEvent;
      if (liveEvent.type === 'exhausted' && options.closeOnExhaust) return;
    }
  } finally {
    stopped = true;
    options.signal?.removeEventListener('abort', abort);
    for (const dispose of cleanup) dispose();
  }
}
