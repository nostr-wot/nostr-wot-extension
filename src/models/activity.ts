import type { NostrEventDisplay } from './nostrEvent.ts';

/**
 * One entry in the activity log: something a site asked this extension to do.
 *
 * `event` was `any`, which defeats the point of typing it at all — and it is
 * the field carrying whatever a site asked to have signed. It is partial
 * because a queued snapshot need not be complete, and null for the methods
 * that involve no event.
 */
export interface ActivityEntry {
  method: string;
  kind?: number | null;
  decision: string;
  timestamp: number;
  domain?: string;
  pubkey?: string;
  theirPubkey?: string | null;
  event?: Partial<NostrEventDisplay> | null;
}
