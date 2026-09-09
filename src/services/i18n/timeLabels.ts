import { t } from './i18n.ts';


export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return t('time.justNow');
  if (seconds < 3600) return t('time.minutesAgo', { n: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('time.hoursAgo', { n: Math.floor(seconds / 3600) });
  return t('time.daysAgo', { n: Math.floor(seconds / 86400) });
}

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
