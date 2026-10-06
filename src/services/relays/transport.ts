import { relayAuthenticationRequired } from '@domain/relays/authenticationErrors.ts';
import { matchesRelayFilter } from '@domain/relays/filter.ts';
import {
  RELAY_AUTH_TIMEOUT_MS,
  MAX_RELAY_FRAME_BYTES,
  MAX_RELAY_QUERY_BYTES,
  MAX_RELAY_QUERY_EVENTS,
  MAX_RELAY_QUEUE,
  RELAY_POOL_IDLE_MS,
  MAX_RELAY_AUTH_CHALLENGE_LENGTH,
  MAX_RECONCILIATION_LOCAL_EVENTS,
} from '@constants/relays.ts';
import { nip77 } from 'nostr-tools';
const { Negentropy, NegentropyStorageVector } = nip77;
import { verifyEvent } from '../../lib/crypto/nip01.ts';
import type { SignedEvent } from '../../domain/nostr/types.ts';
import type { NostrFilter } from '../../domain/relays/types.ts';
import { createRelayPool, createSharedRelaySocket } from './pool.ts';

export interface RelayTransportOptions {
  signal?: AbortSignal;
  scope?: string;
  timeoutMs?: number;
  limit?: number;
  /** Called only on an explicit account-scoped operation; caller owns consent/session checks. */
  authenticate?: (challenge: string, relay: string) => Promise<SignedEvent>;
  /** Rechecked at the actual publication send boundary. */
  assertSession?: () => void;
}
export interface RelayQueryResult {
  events: SignedEvent[];
  status: 'eose' | 'timeout' | 'closed' | 'error';
  message?: string;
  challenge?: string;
  received: number;
}
const bounded = (value: number | undefined, fallback: number, max: number) =>
  Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value!))) : fallback;
const subId = () => `query-${crypto.randomUUID()}`;

async function validateRelayAuthentication(
  event: SignedEvent,
  relay: string,
  challenge: string,
): Promise<void> {
  if (
    event.kind !== 22242 ||
    event.content !== '' ||
    !event.tags.some((t) => t[0] === 'challenge' && t[1] === challenge) ||
    !event.tags.some((t) => t[0] === 'relay' && t[1] === relay) ||
    !(await verifyEvent(event))
  )
    throw new Error('Invalid relay authentication');
}

export function createRelayTransport(
  config: { _createSocket?: (url: string) => WebSocket; idleMs?: number } = {},
) {
  const pool =
    config._createSocket || config.idleMs !== undefined
      ? createRelayPool({ ...config, idleMs: config.idleMs ?? RELAY_POOL_IDLE_MS })
      : createRelayPool();

  function queryRelay(
    relay: string,
    filter: NostrFilter,
    options: RelayTransportOptions = {},
  ): Promise<RelayQueryResult> {
    return new Promise((resolve) => {
      const events: SignedEvent[] = [];
      const seen = new Set<string>();
      const id = subId();
      const limit = bounded(options.limit ?? filter.limit, MAX_RELAY_QUERY_EVENTS, MAX_RELAY_QUERY_EVENTS);
      let received = 0,
        bytes = 0,
        pending = 0,
        messages = 0;
      let done = false,
        accepting = true,
        rejected = false,
        challenge: string | undefined;
      let chain = Promise.resolve();
      let ws: WebSocket | undefined;
      let authTimer: ReturnType<typeof setTimeout> | undefined;
      let authStarted = false,
        authAccepted = false,
        authId: string | undefined,
        needsRetry = false,
        retried = false;
      const timer = setTimeout(
        () => finish('timeout', 'Relay query timed out'),
        bounded(options.timeoutMs, 10000, 60000),
      );
      const finish = (status: RelayQueryResult['status'], message?: string) => {
        if (done) return;
        done = true;
        accepting = false;
        clearTimeout(timer);
        clearTimeout(authTimer);
        options.signal?.removeEventListener('abort', abort);
        if (ws) {
          ws.onclose = ws.onerror = ws.onmessage = ws.onopen = null;
          ws.close();
        }
        resolve({ events, status, message, received, ...(challenge ? { challenge } : {}) });
      };
      const drain = (status: RelayQueryResult['status'], message?: string) => {
        if (!accepting || done) return;
        accepting = false;
        void chain.then(() =>
          finish(
            status === 'eose' && rejected ? 'error' : status,
            status === 'eose' && rejected ? 'Relay sent invalid or out-of-filter events' : message,
          ),
        );
      };
      const abort = () => finish('closed', 'Query cancelled');
      const request = () => {
        options.assertSession?.();
        ws!.send(JSON.stringify(['REQ', id, { ...filter, limit }]));
      };
      const waitForAuthentication = () => {
        authTimer ??= setTimeout(() => finish('closed', 'Relay authentication required: challenge or acknowledgment timed out'), RELAY_AUTH_TIMEOUT_MS);
      };
      const authenticate = () => {
        if (
          authStarted ||
          !challenge ||
          !options.authenticate ||
          !options.scope ||
          options.scope === 'anonymous'
        )
          return;
        authStarted = true;
        clearTimeout(authTimer);
        authTimer = undefined;
        const expectedChallenge = challenge;
        void options
          .authenticate(expectedChallenge, relay)
          .then(async (event) => {
            if (done) return;
            await validateRelayAuthentication(event, relay, expectedChallenge);
            if (done) return;
            options.assertSession?.();
            authId = event.id;
            ws!.send(JSON.stringify(['AUTH', event]));
            if (!authAccepted && !done) waitForAuthentication();
          })
          .catch((error) =>
            finish('closed', error instanceof Error ? error.message : 'Relay authentication refused'),
          );
      };
      const retryAuthenticated = () => {
        if (!options.authenticate || !options.scope || options.scope === 'anonymous' || retried) return false;
        if (authAccepted) {
          retried = true;
          try { request(); } catch (error) { finish('error', String(error)); }
        } else {
          needsRetry = true;
          waitForAuthentication();
          authenticate();
        }
        return true;
      };
      if (options.signal?.aborted) {
        abort();
        return;
      }
      options.signal?.addEventListener('abort', abort, { once: true });
      try {
        ws = pool._createSocket(relay, options.scope);
      } catch (error) {
        finish('error', String(error));
        return;
      }
      ws.onopen = () => {
        try {
          request();
        } catch (error) {
          finish('error', String(error));
        }
      };
      ws.onerror = () => finish('error', 'Relay connection error');
      ws.onclose = (event) => finish('closed', event?.reason || 'Relay connection closed');
      ws.onmessage = (message) => {
        if (done || !accepting) return;
        if (
          typeof message.data !== 'string' ||
          message.data.length > MAX_RELAY_FRAME_BYTES ||
          ++messages > MAX_RELAY_QUERY_EVENTS * 2 ||
          (bytes += new TextEncoder().encode(message.data).length) > MAX_RELAY_QUERY_BYTES
        ) {
          finish('error', 'Relay response limit exceeded');
          return;
        }
        let data: unknown[];
        try {
          data = JSON.parse(message.data);
          if (!Array.isArray(data)) return;
        } catch {
          return;
        }
        if (
          data[0] === 'AUTH' &&
          typeof data[1] === 'string' &&
          data[1].length <= MAX_RELAY_AUTH_CHALLENGE_LENGTH
        ) {
          if (challenge && challenge !== data[1] && authStarted) {
            finish('closed', 'Relay authentication challenge changed');
            return;
          }
          challenge = data[1];
          // An AUTH frame is itself a request to authenticate. Some relays wait
          // silently or send an empty EOSE instead of CLOSED until authenticated.
          if (!authStarted && options.authenticate && options.scope && options.scope !== 'anonymous') {
            needsRetry = true;
            authenticate();
          }
          return;
        }
        if (data[0] === 'OK' && authId && data[1] === authId) {
          if (data[2] !== true) {
            finish('closed', typeof data[3] === 'string' ? data[3] : 'Relay authentication refused');
            return;
          }
          clearTimeout(authTimer);
          authTimer = undefined;
          authAccepted = true;
          if (needsRetry) {
            needsRetry = false;
            retried = true;
            try {
              request();
            } catch (error) {
              finish('error', String(error));
            }
          }
          return;
        }
        if (data[1] !== id) return;
        if (data[0] === 'CLOSED') {
          const reason = typeof data[2] === 'string' ? data[2] : 'Relay closed subscription';
          if (relayAuthenticationRequired(reason) && retryAuthenticated()) return;
          drain('closed', reason);
          return;
        }
        if (data[0] === 'EOSE') {
          if (needsRetry) return; // Wait for AUTH acknowledgement and the authenticated REQ.
          const hint = data[2];
          const authRequired = typeof hint === 'string' ? relayAuthenticationRequired(hint)
            : !!hint && typeof hint === 'object' && 'auth-required' in hint;
          if (authRequired && retryAuthenticated()) return;
          if (data.length > 2 && data[2] !== undefined && data[2] !== null && data[2] !== '')
            drain('closed', `Incomplete relay response: ${JSON.stringify(data[2]).slice(0, 1024)}`);
          else drain('eose');
          return;
        }
        if (data[0] !== 'EVENT') return;
        received++;
        if (received > MAX_RELAY_QUERY_EVENTS || pending >= MAX_RELAY_QUEUE) {
          finish('error', 'Relay verification queue limit exceeded');
          return;
        }
        const event = data[2] as SignedEvent;
        if (!matchesRelayFilter(event, filter)) {
          rejected = true;
          return;
        }
        pending++;
        chain = chain
          .then(async () => {
            try {
              if (!done && !seen.has(event.id)) {
                if (!(await verifyEvent(event))) {
                  rejected = true;
                  return;
                }
                if (done) return;
                if (events.length >= limit) {
                  finish('error', 'Relay event limit exceeded');
                  return;
                }
                seen.add(event.id);
                events.push(event);
              }
            } finally {
              pending--;
            }
          })
          .catch(() => {
            /* malformed event rejected */
          });
      };
    });
  }

  function publishRelay(
    relay: string,
    event: SignedEvent,
    options: RelayTransportOptions = {},
  ): Promise<{ accepted: boolean; message: string }> {
    return new Promise((resolve) => {
      let ws: WebSocket | undefined,
        done = false;
      let challenge: string | undefined,
        authId: string | undefined,
        authStarted = false,
        messages = 0;
      const timer = setTimeout(
        () => finish(false, 'Relay publication timed out'),
        bounded(options.timeoutMs, 5000, 60000),
      );
      const finish = (accepted: boolean, message: string, revoked = false) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        if (ws) {
          ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
          ws.close(1000, revoked ? 'session-invalid' : undefined);
        }
        resolve({ accepted, message });
      };
      const abort = () => finish(false, 'Publication cancelled');
      if (options.signal?.aborted) {
        abort();
        return;
      }
      options.signal?.addEventListener('abort', abort, { once: true });
      try {
        ws = pool._createSocket(relay, options.scope);
      } catch (error) {
        finish(false, String(error));
        return;
      }
      const publish = () => {
        try {
          options.assertSession?.();
          ws!.send(JSON.stringify(['EVENT', event]));
        } catch (error) {
          finish(false, String(error), true);
        }
      };
      ws.onopen = publish;
      ws.onmessage = (message) => {
        if (++messages > 256) {
          finish(false, 'Relay response limit exceeded');
          return;
        }
        try {
          const data = JSON.parse(message.data);
          if (
            data[0] === 'AUTH' &&
            typeof data[1] === 'string' &&
            data[1].length <= MAX_RELAY_AUTH_CHALLENGE_LENGTH
          ) {
            if (authStarted && challenge !== data[1]) {
              finish(false, 'Relay authentication challenge changed');
              return;
            }
            challenge = data[1];
            return;
          }
          if (data[0] !== 'OK') return;
          if (authId && data[1] === authId) {
            if (data[2] === true) {
              authId = undefined;
              publish();
            } else finish(false, typeof data[3] === 'string' ? data[3] : 'Relay authentication refused');
            return;
          }
          if (data[1] !== event.id) return;
          const reason = typeof data[3] === 'string' ? data[3] : '';
          if (
            data[2] !== true &&
            relayAuthenticationRequired(reason) &&
            challenge &&
            options.authenticate &&
            options.scope &&
            options.scope !== 'anonymous' &&
            !authStarted
          ) {
            authStarted = true;
            const expectedChallenge = challenge;
            void options
              .authenticate(expectedChallenge, relay)
              .then(async (authentication) => {
                if (done) return;
                await validateRelayAuthentication(authentication, relay, expectedChallenge);
                if (done) return;
                options.assertSession?.();
                authId = authentication.id;
                ws!.send(JSON.stringify(['AUTH', authentication]));
              })
              .catch((error) => finish(false, String(error), true));
            return;
          }
          finish(data[2] === true, reason);
        } catch {
          /* ignore malformed response */
        }
      };
      ws.onerror = () => finish(false, 'Relay connection error');
      ws.onclose = (event) => finish(false, event?.reason || 'Relay connection closed');
    });
  }

  /** NIP-77 only reconciles IDs. Callers must fetch and verify missing event bodies. */
  function reconcileRelay(
    relay: string,
    filter: NostrFilter,
    entries: Array<{ id: string; created_at: number }>,
    options: RelayTransportOptions = {},
  ): Promise<{ status: 'complete' | 'timeout' | 'closed' | 'error'; missing: string[]; remoteCount?: number; message?: string }> {
    return new Promise((resolve) => {
      let ws: WebSocket | undefined,
        done = false,
        rounds = 0;
      const missing = new Set<string>();
      const localOnly = new Set<string>();
      const id = subId();
      const timer = setTimeout(
        () => finish('timeout', 'NIP-77 timed out'),
        bounded(options.timeoutMs, 10000, 60000),
      );
      const finish = (status: 'complete' | 'timeout' | 'closed' | 'error', message?: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        if (ws) {
          ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
          try {
            ws.send(JSON.stringify(['NEG-CLOSE', id]));
          } catch {
            /* disconnected */
          }
          ws.close();
        }
        resolve({ status, missing: [...missing], remoteCount: status === 'complete' ? entries.length - localOnly.size + missing.size : undefined, message });
      };
      const abort = () => finish('closed', 'Reconciliation cancelled');
      if (options.signal?.aborted) {
        abort();
        return;
      }
      options.signal?.addEventListener('abort', abort, { once: true });
      let neg: InstanceType<typeof Negentropy>;
      try {
        if (entries.length > MAX_RECONCILIATION_LOCAL_EVENTS)
          throw new Error('NIP-77 local inventory limit exceeded');
        const storage = new NegentropyStorageVector();
        for (const entry of entries) {
          if (
            !/^[0-9a-f]{64}$/.test(entry.id) ||
            !Number.isSafeInteger(entry.created_at) ||
            entry.created_at < 0
          )
            throw new Error('Invalid local inventory');
          storage.insert(entry.created_at, entry.id);
        }
        storage.seal();
        neg = new Negentropy(storage, 60000);
        ws = pool._createSocket(relay, options.scope);
      } catch (error) {
        finish('error', String(error));
        return;
      }
      ws.onopen = () => {
        try {
          options.assertSession?.();
          ws!.send(JSON.stringify(['NEG-OPEN', id, filter, neg.initiate()]));
        } catch (error) {
          finish('error', String(error));
        }
      };
      ws.onmessage = (message) => {
        try {
          const data = JSON.parse(message.data);
          if (data[0] === 'AUTH' && options.authenticate && options.scope && options.scope !== 'anonymous') {
            // Continue through the authenticated paginated reader on the same pooled socket.
            finish('closed', 'Relay authentication required');
            return;
          }
          if (data[1] !== id) return;
          if (data[0] === 'NEG-ERR' || data[0] === 'CLOSED') {
            finish('closed', String(data[2]));
            return;
          }
          if (data[0] !== 'NEG-MSG') return;
          if (
            ++rounds > 128 ||
            typeof data[2] !== 'string' ||
            data[2].length > 120000 ||
            !/^[0-9a-f]+$/i.test(data[2]) ||
            data[2].length % 2
          )
            throw new Error('NIP-77 response limit exceeded');
          const response = neg.reconcile(data[2], (id) => { localOnly.add(id); }, (needed) => {
            if (missing.size >= MAX_RELAY_QUERY_EVENTS) throw new Error('NIP-77 missing ID limit exceeded');
            missing.add(needed);
          });
          if (response) {
            options.assertSession?.();
            ws!.send(JSON.stringify(['NEG-MSG', id, response]));
          } else finish('complete');
        } catch (error) {
          finish('error', String(error));
        }
      };
      ws.onerror = () => finish('error', 'Relay connection error');
      ws.onclose = (event) => finish('closed', event?.reason || 'Relay connection closed');
    });
  }
  return { queryRelay, publishRelay, reconcileRelay, _createSocket: pool._createSocket, close: pool.close };
}

const shared = createRelayTransport();
export const queryRelay = shared.queryRelay;
export const publishRelay = shared.publishRelay;
export const reconcileRelay = shared.reconcileRelay;
export { createSharedRelaySocket };
