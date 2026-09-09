import { parseLnurl } from './lnurl.ts';

/**
 * What, if anything, the wallet's Send box should pay right now.
 *
 * The Send field accepts both a BOLT11 invoice and a Lightning Address, and an
 * address has to be resolved over the network before it can be paid. That
 * resolution is debounced, which opens a window where two answers to "who is
 * being paid" disagree: the text on screen, and the `ResolvedAddress` last
 * fetched. The component used to branch on the resolved value while the Pay
 * button was gated on the text, so during the debounce it would enable Pay and
 * send to the *previously* resolved address — the field said bob, the sats went
 * to alice.
 *
 * Deciding it here makes the rule explicit and testable: an address is payable
 * only when the resolution on hand is the resolution for the text on screen.
 * Anything else is `none`, with the reason the UI needs to explain itself.
 */

export interface ResolvedAddressLike {
  address: string;
  minSats: number;
  maxSats: number;
}

export type SendTarget =
  | { kind: 'address'; address: string; amountSats: number }
  | { kind: 'invoice'; bolt11: string }
  | { kind: 'none'; reason: 'empty' | 'resolving' | 'unresolved' | 'amount' };

export interface SendTargetInput {
  /** Raw contents of the Send field. */
  input: string;
  /** True when `input` parses as a Lightning Address or LNURL rather than an invoice. */
  isAddress: boolean;
  /** The most recent resolution held by the component, whatever it is for. */
  resolved: ResolvedAddressLike | null;
  /** Contents of the amount field; only consulted for an address. */
  amount: string;
  /** True when the field holds an invoice this client could decode. */
  invoiceDecodable: boolean;
}

/**
 * Resolve the Send box to the one thing it may pay.
 *
 * @returns a payable target, or `none` with the reason it is not payable.
 */
export function resolveSendTarget(
  { input, isAddress, resolved, amount, invoiceDecodable }: SendTargetInput,
): SendTarget {
  const trimmed = input.trim();
  if (!trimmed) return { kind: 'none', reason: 'empty' };

  if (!isAddress) {
    if (!invoiceDecodable) return { kind: 'none', reason: 'unresolved' };
    return { kind: 'invoice', bolt11: trimmed };
  }

  // LUD-16 addresses are lowercase, and that is the form we resolve and store.
  const wanted = parseLnurl(trimmed)?.encoded ?? trimmed.toLowerCase();
  if (!resolved) return { kind: 'none', reason: 'resolving' };

  // The load-bearing line: a resolution for some *other* address is not a
  // resolution for this one. Without it, the debounce window pays the old one.
  if (resolved.address !== wanted) return { kind: 'none', reason: 'resolving' };

  const amountSats = Number(amount);
  if (!Number.isInteger(amountSats)
    || amountSats < resolved.minSats
    || amountSats > resolved.maxSats) {
    return { kind: 'none', reason: 'amount' };
  }

  return { kind: 'address', address: resolved.address, amountSats };
}

/** Convenience for the Pay button: is there anything to send? */
export function canSend(input: SendTargetInput): boolean {
  return resolveSendTarget(input).kind !== 'none';
}
