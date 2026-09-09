import { t } from '@services/i18n/i18n.ts';

export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return t('time.justNow');
  if (seconds < 3600) return t('time.minutesAgo', { n: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('time.hoursAgo', { n: Math.floor(seconds / 3600) });
  return t('time.daysAgo', { n: Math.floor(seconds / 86400) });
}

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

/**
 * `formatTimeAgo` for a transaction row: seconds-based, guards a missing or
 * future timestamp, and falls back to a short date past a week rather than
 * counting days forever.
 *
 * Kept separate from `formatTimeAgo` rather than merged into it because the
 * input unit differs — that one takes milliseconds, and a wallet's `createdAt`
 * is seconds. Collapsing them is how you get a transaction dated 1970.
 */
export function formatTxDate(ts: number, now: Date = new Date()): string {
  if (!ts || ts <= 0) return '—';
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return '—';

  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return d.toLocaleDateString();

  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t('time.justNow');
  if (diffMin < 60) return t('time.minutesAgo', { n: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t('time.hoursAgo', { n: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay <= 7) return t('time.daysAgo', { n: diffDay });

  // Older than a week: a short date reads better than "43 days ago".
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
