import browser from '@lib/browser.ts';
import { AsyncLock } from '@utils/asyncLock.ts';
import type { SigningRejection } from '@domain/signing/rejection.ts';
import type { PendingRequest } from '@domain/signing/types.ts';
import { SIGNER_REJECTIONS_KEY, MAX_SIGNER_REJECTIONS, SIGNER_BADGE_PENDING_COLOR, SIGNER_BADGE_REJECTED_COLOR } from '@constants/signing.ts';

const writes = new AsyncLock();
const badges = new AsyncLock();

export async function getSigningRejections(): Promise<SigningRejection[]> {
  const stored = await browser.storage.local.get(SIGNER_REJECTIONS_KEY);
  return (stored[SIGNER_REJECTIONS_KEY] || []) as SigningRejection[];
}

/** Read current storage inside the lock so queue updates cannot overwrite red. */
export async function updateSignerBadge(): Promise<void> {
  await badges.run(async () => {
    try {
      const rejections = await getSigningRejections();
      const stored = await browser.storage.session.get('signerPending');
      const pending = ((stored.signerPending || []) as PendingRequest[]).filter(r => !r.nip46InFlight).length;
      const count = rejections.length || pending;
      await browser.action.setBadgeBackgroundColor({ color: rejections.length ? SIGNER_BADGE_REJECTED_COLOR : SIGNER_BADGE_PENDING_COLOR });
      await browser.action.setBadgeText({ text: count ? String(count) : '' });
    } catch { /* A badge failure must not prevent rejecting a request. */ }
  });
}

export async function recordSigningRejection(input: Omit<SigningRejection, 'id' | 'timestamp' | 'reason'>): Promise<void> {
  await writes.run(async () => {
    const previous = await getSigningRejections();
    const item: SigningRejection = { ...input, id: crypto.randomUUID(), timestamp: Date.now(), reason: 'accountMismatch' };
    await browser.storage.local.set({ [SIGNER_REJECTIONS_KEY]: [item, ...previous].slice(0, MAX_SIGNER_REJECTIONS) });
  });
  await updateSignerBadge();
}

/** Acknowledge only displayed IDs, preserving rejections arriving concurrently. */
export async function acknowledgeSigningRejections(ids: string[]): Promise<void> {
  const acknowledged = new Set(ids);
  await writes.run(async () => {
    const previous = await getSigningRejections();
    await browser.storage.local.set({ [SIGNER_REJECTIONS_KEY]: previous.filter(item => !acknowledged.has(item.id)) });
  });
  await updateSignerBadge();
}
