export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export type DayKind = 'today' | 'yesterday' | 'other';

/**
 * Classify a `Date#toDateString()` value relative to `now`, for a caller that
 * wants to render "Today" / "Yesterday" and fall back to the date itself.
 *
 * Pure and clock-injectable so the day boundary is testable without waiting
 * for midnight, and kept out of `t()` on purpose: the actual label strings
 * are the caller's own translation keys (the activity log's are
 * `activity.today` / `activity.yesterday`), and a formatter that returned
 * text instead of a classification would tie every caller to one screen's keys.
 */
export function classifyDay(day: string, now: Date = new Date()): DayKind {
  if (day === now.toDateString()) return 'today';
  if (day === new Date(now.getTime() - 86400000).toDateString()) return 'yesterday';
  return 'other';
}
