import type { UnsignedEvent } from '../nostr/types.ts';

// ── Signer ──

export interface PendingRequest {
  id: string;
  type: string;
  origin: string;
  /** Pubkey of the account snapshotted when the request was queued — the
   *  identity the user saw in the prompt, NOT the current active account. */
  pubkey?: string;
  /** Snapshot of the event to be signed, shown in the approval UI.
   *  For signEvent requests this carries the FULL `content` and FULL `tags`
   *  for EVERY kind — never truncated — so the prompt displays exactly what
   *  will be signed and a site cannot hide payload from the user. */
  event?: Partial<UnsignedEvent>;
  theirPubkey?: string;
  permKey?: string | null;
  eventKind?: number;
  needsPermission?: boolean;
  waitingForUnlock?: boolean;
  nip46InFlight?: boolean;
  accountId?: string | null;
  walletAmount?: number;
  timestamp: number;
}

export interface RequestDecision {
  allow: boolean;
  remember?: boolean;
  rememberKind?: boolean;
  reason?: string;
}
