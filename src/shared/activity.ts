export interface ActivityEntry {
  method: string;
  kind?: number | null;
  decision: string;
  timestamp: number;
  domain?: string;
  pubkey?: string;
  theirPubkey?: string;
  event?: any;
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
    let key = methodKey + '|' + entry.decision + '|' + timeKey;
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
