import React, { useEffect, useRef, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import useVaultUnlock from '@hooks/useVaultUnlock.ts';
import styles from './PromptApp.module.css';
import { isVaultOpen } from '@shared/vaultAutoUnlock.ts';

interface UnlockSectionProps {
  onUnlocked: () => void;
}

export default function UnlockSection({ onUnlocked }: UnlockSectionProps) {
  const { password, setPassword, error, setError, loading, lockedUntil, inputRef, unlock } =
    useVaultUnlock({ onSuccess: onUnlocked, messages: { lockedOut: t('unlock.lockedOut') } });

  const isLockedOut = lockedUntil > Date.now();

  // A never-lock vault is stored under the empty password, so it can just be
  // opened. Shared, because the mode check in front of it is load-bearing —
  // see src/shared/vaultAutoUnlock.ts.
  // Held in a ref: `onUnlocked` is a new identity on every parent render, and
  // keying the effect on it re-ran the whole probe each time.
  const onUnlockedRef = useRef(onUnlocked);
  onUnlockedRef.current = onUnlocked;

  useEffect(() => {
    isVaultOpen(rpc).then((open) => { if (open) onUnlockedRef.current?.(); }).catch(() => {});
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className={styles.unlockSection}>
      <span className={styles.unlockLabel}>{t('prompt.vaultLocked')}</span>
      <input
        ref={inputRef}
        className={styles.unlockInput}
        type="password"
        placeholder={t('prompt.enterVaultPassword')}
        autoComplete="off"
        value={password}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { setPassword(e.target.value); setError(''); }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && !isLockedOut && unlock()}
        disabled={loading || isLockedOut}
      />
      {error && <span className={styles.unlockError}>{error}</span>}
    </div>
  );
}
