import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import type { Account } from '@domain/accounts/account.ts';
import type { ProfileMetadata } from '@domain/profile/profileMetadata.ts';
import { truncateNpub } from '@utils/format/text.ts';

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
  /** Ciphertext only; plaintext is never retained in the activity log. */
  ciphertext?: string;
  event?: Partial<NostrEventDisplay> | null;
}

export interface GroupedActivity {
  methodKey: string;
  decision: string;
  timestamp: number;
  timeKey: string;
  count: number;
  entries: ActivityEntry[];
  day?: string;
  domain?: string;
}

export interface GroupActivityOptions {
  includeDay?: boolean;
  includeDomain?: boolean;
}

/**
 * Groups activity entries by method+decision+time.
 * @param entries - Activity log entries with { method, kind, decision, timestamp, domain }
 * @param opts - { includeDay: bool, includeDomain: bool }
 * @returns Grouped entries sorted by most recent
 */
export function groupActivityEntries(
  entries: ActivityEntry[],
  { includeDay = false, includeDomain = false }: GroupActivityOptions = {}
): GroupedActivity[] {
  const groups = new Map<string, GroupedActivity>();
  for (const entry of entries) {
    const methodKey = entry.method + (entry.kind != null ? ':' + entry.kind : '');
    const d = new Date(entry.timestamp);
    const timeKey = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    let key = (entry.pubkey || '') + '|' + methodKey + '|' + entry.decision + '|' + timeKey;
    if (includeDay) key = d.toDateString() + '::' + key;
    if (includeDomain) key = (entry.domain || '') + '::' + key;

    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      existing.entries.push(entry);
    } else {
      groups.set(key, {
        methodKey,
        decision: entry.decision,
        timestamp: entry.timestamp,
        timeKey,
        count: 1,
        entries: [entry],
        ...(includeDay && { day: d.toDateString() }),
        ...(includeDomain && { domain: entry.domain }),
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.timestamp - a.timestamp);
}

// ── Filtering ──

/**
 * Which wire methods each grouped type filter covers.
 *
 * `encrypt` and `decrypt` deliberately span both NIP-04 and NIP-44: to a user
 * asking "what did this site read?", the scheme is an implementation detail.
 * Advanced mode exposes the four individually.
 */
export const TYPE_METHODS: Record<string, string[]> = {
  signEvent: ['signEvent'],
  getPublicKey: ['getPublicKey'],
  encrypt: ['nip04Encrypt', 'nip44Encrypt'],
  decrypt: ['nip04Decrypt', 'nip44Decrypt'],
  nip04Encrypt: ['nip04Encrypt'],
  nip04Decrypt: ['nip04Decrypt'],
  nip44Encrypt: ['nip44Encrypt'],
  nip44Decrypt: ['nip44Decrypt'],
};

/** Display order for the type-filter chips in simple mode. */
const SIMPLE_TYPE_ORDER = ['signEvent', 'getPublicKey', 'encrypt', 'decrypt'];
/** Display order in advanced mode — one chip per wire method instead of the
 *  collapsed encrypt/decrypt pair. */
const ADVANCED_TYPE_ORDER = ['signEvent', 'getPublicKey', 'nip04Encrypt', 'nip44Encrypt', 'nip04Decrypt', 'nip44Decrypt'];

/**
 * Which type-filter keys to offer, scoped to the selected domain/account and
 * ordered for display — only keys with at least one matching entry appear, so
 * the filter panel never offers a chip that would empty the list.
 *
 * This was inline in the overlay as two separate `useMemo`s (the set of
 * present methods, then which chips that unlocks); collapsed into one
 * function because neither half means anything on its own.
 */
export function availableTypeKeys(
  entries: ActivityEntry[],
  filters: { domain?: string | null; account?: string | null },
  advanced: boolean,
): string[] {
  const scoped = filterActivityEntries(entries, { domain: filters.domain, account: filters.account });
  const present = new Set(scoped.map((e) => e.method).filter(Boolean) as string[]);
  const order = advanced ? ADVANCED_TYPE_ORDER : SIMPLE_TYPE_ORDER;
  return order.filter((key) => TYPE_METHODS[key].some((m) => present.has(m)));
}

export interface ActivityFilters {
  /** Restrict to one account's pubkey. */
  account?: string | null;
  /** Restrict to one site. */
  domain?: string | null;
  /** A key of TYPE_METHODS. */
  type?: string | null;
  /** Substring match against the counterparty pubkey. */
  pubkeyQuery?: string | null;
}

/**
 * Does this entry involve `query` as a counterparty?
 *
 * Checks the recorded `theirPubkey` and the event's `p` tags, because the
 * counterparty of a signed event is in its tags rather than on the log entry —
 * searching only the former silently misses every note that mentions someone.
 */
function mentionsPubkey(entry: ActivityEntry, query: string): boolean {
  const q = query.toLowerCase();
  if (entry.theirPubkey && entry.theirPubkey.toLowerCase().includes(q)) return true;
  for (const tag of entry.event?.tags ?? []) {
    if (tag[0] === 'p' && tag[1] && tag[1].toLowerCase().includes(q)) return true;
  }
  return false;
}

/** Apply the filter bar. An unset filter narrows nothing. */
export function filterActivityEntries(
  entries: ActivityEntry[],
  filters: ActivityFilters,
): ActivityEntry[] {
  let out = entries;
  if (filters.account) out = out.filter((e) => e.pubkey === filters.account);
  if (filters.domain) out = out.filter((e) => e.domain === filters.domain);
  if (filters.type) {
    const methods = TYPE_METHODS[filters.type];
    // An unknown type key narrows nothing rather than hiding everything: the
    // filter list and this table can drift, and an empty screen reads as "no
    // activity" rather than "bad filter".
    if (methods) out = out.filter((e) => !!e.method && methods.includes(e.method));
  }
  if (filters.pubkeyQuery) {
    const q = filters.pubkeyQuery;
    out = out.filter((e) => mentionsPubkey(e, q));
  }
  return out;
}

/** How many filters are actually narrowing anything — drives the badge. */
export function countActivityFilters(filters: ActivityFilters): number {
  return (filters.type ? 1 : 0) + (filters.pubkeyQuery ? 1 : 0);
}

export interface ActivityAccountOption {
  pubkey: string;
  label: string;
}

/**
 * The accounts that actually appear in the log, each labelled with whatever a
 * user would recognize them by: a resolved profile name first, then the
 * account's own nickname, then a truncated npub — in that order because a
 * profile can go stale (a relay round trip that never lands) but a nickname
 * is what the user typed themselves, and an npub is always available.
 */
export function activityAccountOptions(
  entries: ActivityEntry[],
  accounts: Account[],
  profileCache: Record<string, ProfileMetadata | undefined>,
): ActivityAccountOption[] {
  const pubkeys = [...new Set(entries.map((e) => e.pubkey).filter(Boolean))] as string[];
  return pubkeys.map((pubkey) => {
    const profile = profileCache[pubkey];
    const account = accounts.find((a) => a.pubkey === pubkey);
    const label = profile?.name || account?.name || truncateNpub(pubkey);
    return { pubkey, label };
  });
}

/** The distinct sites present in a log, for the domain picker. */
export function activityDomains(entries: ActivityEntry[]): string[] {
  return [...new Set(entries.map((e) => e.domain).filter(Boolean) as string[])].sort();
}

/**
 * Insert a header before each new day.
 *
 * The label itself stays with the caller: "Today" and "Yesterday" need `t()`,
 * and the day boundary is the part worth testing.
 */
export type DayGroupItem<T extends { day?: string }> =
  | { type: 'header'; day: string }
  | { type: 'entry'; entry: T };

export function buildDayGroups<T extends { day?: string }>(groups: T[]): DayGroupItem<T>[] {
  const out: DayGroupItem<T>[] = [];
  let current: string | null = null;
  for (const g of groups) {
    const day = g.day ?? '';
    if (day !== current) {
      current = day;
      out.push({ type: 'header', day });
    }
    out.push({ type: 'entry', entry: g });
  }
  return out;
}


/** Stable identity for a saved entry, including account and encrypted body. */
export function activityEntryKey(entry: ActivityEntry): string {
  return JSON.stringify([entry.timestamp, entry.domain, entry.pubkey, entry.method,
    entry.decision, entry.theirPubkey, entry.ciphertext, entry.event]);
}

/** Determine a supported encrypted body without treating arbitrary notes as ciphertext. */
export function activityEncryption(entry: ActivityEntry) {
  const event = entry.event;
  const ciphertext = entry.ciphertext || event?.content;
  if (!ciphertext || !entry.pubkey) return null;
  const nip04 = entry.method.startsWith('nip04') || event?.kind === 4 || /^[A-Za-z0-9+/]+=*\?iv=[A-Za-z0-9+/]+=*$/.test(ciphertext);
  const nip44 = entry.method.startsWith('nip44') || event?.kind === 13 || event?.kind === 1059 || event?.kind === 21059 ||
    ((event?.kind === 10000 || event?.kind === 30078) && /^[A-Za-z0-9+/]{99,}={0,2}$/.test(ciphertext));
  if (!nip04 && !nip44) return null;
  const accountPubkey = entry.pubkey;
  const author = typeof event?.pubkey === 'string' ? event.pubkey : null;
  const peerPubkey = entry.theirPubkey ||
    (author && author !== accountPubkey ? author : null) ||
    event?.tags?.find(tag => tag[0] === 'p' && tag[1] !== accountPubkey)?.[1] ||
    (event?.kind === 10000 || event?.kind === 30078 ? accountPubkey : null);
  return { scheme: nip04 ? 'nip04' as const : 'nip44' as const, ciphertext, accountPubkey, peerPubkey };
}
