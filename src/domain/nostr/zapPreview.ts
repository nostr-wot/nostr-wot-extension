import type { NostrEventDisplay } from './nostrEvent';

/** Display only: never infer an amount or recipient from ambiguous NIP-57 tags. */
export function zapPreview(event: Partial<NostrEventDisplay>) {
  const amounts = (event.tags || []).filter(tag => tag[0] === 'amount');
  const recipients = (event.tags || []).filter(tag => tag[0] === 'p');
  const raw = amounts.length === 1 && amounts[0].length === 2 ? amounts[0][1] : undefined;
  const amountMsats = raw && /^[0-9]{1,24}$/.test(raw) && BigInt(raw) > 0n ? raw : null;
  const recipient = recipients.length === 1 && /^[a-f0-9]{64}$/i.test(recipients[0][1] || '') ? recipients[0][1] : null;
  return { amountMsats, recipient };
}

