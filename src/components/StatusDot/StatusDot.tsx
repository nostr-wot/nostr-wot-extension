import { cn } from '@utils/cn.ts';

const ALIASES: Record<string, string> = { allow: 'approved', deny: 'rejected', syncing: 'checking', synced: 'reachable' };

// Status -> tone utilities, as an explicit map rather than `styles[normalized]`.
// The dynamic lookup was invisible to tests/css-selectors.test.ts (it skips any
// stylesheet a component indexes into with a computed key) — naming every case
// here removes the dynamic access, same as PermissionsSection's DECISION_DOT_TONE.
const TONE: Record<string, string> = {
  reachable: 'bg-success-bright',
  approved: 'bg-success-bright',
  unreachable: 'bg-error-bright',
  rejected: 'bg-error-bright',
  checking: 'bg-warning-bright animate-dot-pulse',
  blocked: 'bg-warning-bright',
  pending: 'bg-warning-bright animate-dot-pulse',
};

interface StatusDotProps {
  status: string;
  className?: string;
}

// Fixed geometry (7px, not on the 2px token scale) and always applied.
const DOT = 'w-[7px] h-[7px] rounded-full shrink-0 inline-block';

export default function StatusDot({ status, className = '' }: StatusDotProps) {
  const normalized = ALIASES[status] || status;
  const cls = cn(DOT, TONE[normalized] || '', className);
  return <span className={cls} />;
}
