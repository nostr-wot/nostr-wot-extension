import React from 'react';
import styles from './StatusDot.module.css';
import { cn } from '@utils/cn.ts';

const ALIASES: Record<string, string> = { allow: 'approved', deny: 'rejected', syncing: 'checking', synced: 'reachable' };

interface StatusDotProps {
  status: string;
  className?: string;
}

// Fixed geometry (7px, not on the 2px token scale) and always applied, so it
// is a plain utility string rather than a styles.dot lookup. The tone classes
// stay in StatusDot.module.css: `normalized` is an arbitrary caller-supplied
// string, so `styles[normalized]` is a dynamic lookup no scanner can resolve
// statically (see docs/component-standards.md §7).
const DOT = 'w-[7px] h-[7px] rounded-full shrink-0 inline-block';

export default function StatusDot({ status, className = '' }: StatusDotProps) {
  const normalized = ALIASES[status] || status;
  const cls = cn(DOT, styles[normalized] || '', className);
  return <span className={cls} />;
}
