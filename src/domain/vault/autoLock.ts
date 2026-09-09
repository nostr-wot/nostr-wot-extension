export { AUTO_LOCK_OPTIONS } from '@constants/vault.ts';
/** The auto-lock intervals the security screen offers. */
export interface AutoLockOption {
  ms: number;
  labelKey: string;
}
