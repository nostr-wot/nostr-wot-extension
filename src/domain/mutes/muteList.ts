/**
 * The user's own NIP-51 mute list (kind:10000), as the popup reads it.
 *
 * Mirrors `GroupedMuteList` in lib/bg/profile-handlers.ts, which is what
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
