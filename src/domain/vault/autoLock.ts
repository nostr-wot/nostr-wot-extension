/** The auto-lock intervals the security screen offers. */
export interface AutoLockOption {
  ms: number;
  labelKey: string;
}

export const AUTO_LOCK_OPTIONS: readonly AutoLockOption[] = [
  { ms: 300000, labelKey: 'security.5min' },
  { ms: 900000, labelKey: 'security.15min' },
  { ms: 3600000, labelKey: 'security.1hr' },
  { ms: 0, labelKey: 'security.never' },
] as const;
