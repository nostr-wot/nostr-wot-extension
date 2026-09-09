import { useEffect, useRef, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import useVaultUnlock from '@hooks/useVaultUnlock.ts';
import { isVaultOpen } from '@domain/vault/vaultAutoUnlock.ts';

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
    <div className="p-5 bg-[rgba(217,119,6,0.1)] border border-[rgba(217,119,6,0.15)] rounded-md flex flex-col gap-3">
      <span className="text-sm font-bold uppercase tracking-[0.5px] text-warning">{t('prompt.vaultLocked')}</span>
      <input
        ref={inputRef}
        className="w-full p-5 border border-card-active rounded-sm bg-input text-heading text-lg outline-none focus:border-brand focus:shadow-[var(--focus-ring)]"
        type="password"
        placeholder={t('prompt.enterVaultPassword')}
        autoComplete="off"
        value={password}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { setPassword(e.target.value); setError(''); }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && !isLockedOut && unlock()}
        disabled={loading || isLockedOut}
      />
      {error && <span className="text-sm text-error">{error}</span>}
    </div>
  );
}
