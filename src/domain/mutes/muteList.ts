/**
 * The user's own NIP-51 mute list (kind:10000), as the popup reads it.
 *
 * Mirrors `GroupedMuteList` in services/background/profile-handlers.ts, which is what
 * `getMyMuteList` returns. Two screens declared their own version and they were
 * not the same: the home row wanted three counts, the editor needed all six
 * fields — including `rawContent`, which is the still-encrypted private half
 * and must be round-tripped verbatim or publishing destroys it.
 */
export interface MyMuteList {
  people: string[];
  words: string[];
  hashtags: string[];
  events: string[];
  /** The NIP-44-encrypted private entries, preserved exactly as received. */
  rawContent: string;
  createdAt: number;
}

import { npubDecode } from '@lib/crypto/bech32.ts';

export function toHexPubkey(input: string): string | null {
  const value = input.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  try { return npubDecode(value); } catch { return null; }
}

export function normalizeHashtag(input: string): string | null {
  const value = input.trim().replace(/^#/, '').toLowerCase();
  return value && !/[\s#]/.test(value) ? value : null;
}

export type MuteListRead = MyMuteList & { reachable?: boolean };
/** A missing event is different from an empty public half or a failed read. */
export function muteListState(list: MuteListRead | null) {
  if (!list) return 'loading';
  if (list.reachable === false) return 'unavailable';
  if (list.createdAt === 0) return 'missing';
  if (list.people.length + list.words.length + list.hashtags.length + list.events.length > 0) return 'ready';
  return list.rawContent ? 'private' : 'empty';
}
