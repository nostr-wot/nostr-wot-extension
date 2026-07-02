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
