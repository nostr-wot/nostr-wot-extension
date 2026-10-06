import { MAX_ARCHIVE_AUTH_ATTEMPTS } from '@constants/archive.ts';
import { relayAuthenticationError, relayAuthConfigurationError } from '@domain/relays/authenticationErrors.ts';
import type { SignedEvent } from '@domain/nostr/types.ts';
import type { NostrFilter } from '@domain/relays/types.ts';
import { queryRelay, type RelayTransportOptions } from '../relays/transport.ts';

/** Retry recoverable AUTH failures on fresh connections, retaining partial signed results. */
export async function queryArchiveRelay(relay: string, filter: NostrFilter, options: RelayTransportOptions, query = queryRelay) {
  const deadline = Date.now() + (options.timeoutMs ?? 10000);
  const events = new Map<string, SignedEvent>();
  let received = 0;
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    options.assertSession?.();
    const result = await query(relay, filter, {
      ...options,
      timeoutMs: Math.max(1, deadline - Date.now()),
      scope: attempt ? `${options.scope}:reauth:${crypto.randomUUID()}` : options.scope,
    });
    for (const event of result.events) events.set(event.id, event);
    received = Math.max(received, result.received, events.size);
    const reason = result.message ?? '';
    if (attempt + 1 >= MAX_ARCHIVE_AUTH_ATTEMPTS || Date.now() >= deadline || !options.authenticate || !options.scope || options.scope === 'anonymous' || !relayAuthenticationError(reason) || relayAuthConfigurationError(reason)) {
      return { ...result, events: [...events.values()], received };
    }
  }
}
