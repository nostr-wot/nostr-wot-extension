import type { UnsignedEvent } from '@domain/nostr/types.ts';
/**
 * What the post-quantum surfaces should say, given what the background reports.
 *
 * The shapes were declared twice — once in PqcCard, once in PqcSection — as
 * narrower restatements of the same two RPC contracts, and the rule below was
 * inline in the card with a comment explaining the case that matters and
 * nothing asserting it.
 */

export interface PqcStatus {
  canDerive: boolean;
  canImport: boolean;
  source: 'derived' | 'imported' | null;
  reason: PqcBlockReason | null;
}

export interface PqcPublished {
  published: boolean;
  current: boolean;
  /** True when the relays could not be reached, so `published` carries no information. */
  unreachable?: boolean;
}

export type PqcBlockReason = 'read-only' | 'remote-signer' | 'no-seed' | 'short-seed';

/**
 * Everything the settings panel needs, which is more than the home card does.
 *
 * Kept here rather than in the panel so the import sub-panel can hand a status
 * back without either file importing the other.
 */
export interface PqcPanelStatus extends PqcStatus {
  wordCount: number | null;
  pubkey: string | null;
  keys: { kem: string; dsa: string } | null;
  attestation: UnsignedEvent | null;
}

/** What the home card shows. `null` means: show nothing at all. */
export type PqcCardState = 'enabled' | 'stale' | 'setup' | 'import';

/**
 * @param status the `pqc_getStatus` answer, or null if the read failed
 * @param published the `pqc_checkPublished` answer, or null if the read failed
 */
export function derivePqcCardState(
  status: PqcStatus | null | undefined,
  published: PqcPublished | null | undefined,
): PqcCardState | null {
  if (!status) return null;

  if (!status.canDerive) {
    // Nothing to derive. Offer the import path only where imported keys could
    // actually be used; otherwise say nothing rather than advertise a dead end.
    return status.canImport ? 'import' : null;
  }

  // A read that did not come back is not "nothing is published". Coercing it to
  // that told a user who had published to go and set it up again, and would have
  // had them republish an attestation that was already correct — on exactly the
  // flaky-relay day that produced the failed read.
  if (!published || published.unreachable) return null;

  if (!published.published) return 'setup';
  return published.current ? 'enabled' : 'stale';
}

/**
 * Whether the attestation is already out there and current — so the panel can
 * stop offering Publish.
 *
 * `justPublished` covers the moment right after a successful publish, before
 * any relay re-check has happened.
 */
export function isAlreadyPublished(
  existing: PqcPublished | null | undefined,
  justPublished = false,
): boolean {
  if (justPublished) return true;
  return !!existing && !existing.unreachable && existing.published && existing.current;
}

/** Keep publication evidence only while the same account and keys are active. */
export function mergePqcStatus(previous: { status: PqcPanelStatus | null; published: PqcPublished | null }, status: PqcPanelStatus) {
  const sameKeys = previous.status?.pubkey === status.pubkey && previous.status?.keys?.kem === status.keys?.kem && previous.status?.keys?.dsa === status.keys?.dsa;
  return { status, published: sameKeys ? previous.published : null };
}

/** A failed background refresh must not make a confirmed key disappear. */
export function mergePqcPublished(previous: PqcPublished | null, next: PqcPublished | null): PqcPublished | null {
  return !next || next.unreachable ? (previous || next) : next;
}
