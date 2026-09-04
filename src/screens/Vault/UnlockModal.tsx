import React, { useState, useEffect, useCallback, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@lib/i18n.js';
import { useAccount } from '@context/AccountContext';
import { useVault } from '@context/VaultContext';
import useVaultUnlock from '@hooks/useVaultUnlock.ts';
import { useAnimatedVisible } from '@hooks/useAnimatedVisible.ts';
import Avatar from '@components/Avatar/Avatar';
import Button from '@components/Button/Button';
import IconButton from '@components/IconButton/IconButton';
import { IconClose } from '@assets';
import LinkButton from '@components/LinkButton/LinkButton';
import FormError from '@components/FormError/FormError';

interface WaiterInfo {
  id: string;
  type: string;
  origin: string;
  [key: string]: any;
}

interface UnlockModalProps {
  visible: boolean;
  fullScreen?: boolean;
  message?: string;
  unlockWaiters?: WaiterInfo[];
  onUnlocked?: () => void;
  onCancel?: () => void;
}

function getEventLabel(type: string): string {
  const labels: Record<string, string> = {
    signEvent: t('approval.signEvent'),
    nip04Encrypt: t('approval.nip04Encrypt'),
    nip04Decrypt: t('approval.nip04Decrypt'),
    nip44Encrypt: t('approval.nip44Encrypt'),
    nip44Decrypt: t('approval.nip44Decrypt'),
    getPublicKey: t('activity.getPublicKey'),
  };
  return labels[type] || type;
}

export default function UnlockModal({ visible, fullScreen, message, unlockWaiters, onUnlocked, onCancel }: UnlockModalProps) {
  const { displayName, avatarUrl, initial } = useAccount();
  const vault = useVault();
  const [confirmReset, setConfirmReset] = useState<boolean>(false);

  const handleSuccess = useCallback(() => {
    vault.checkState();
    onUnlocked?.();
  }, [vault, onUnlocked]);

  const { password, setPassword, error, loading, lockedUntil, inputRef, unlock, reset, focus } =
    useVaultUnlock({
      onSuccess: handleSuccess,
      messages: {
        wrongPassword: t('key.wrongPassword'),
        unlockFailed: t('key.failedUnlock'),
        lockedOut: t('unlock.lockedOut'),
      },
    });

  const isLockedOut = lockedUntil > Date.now();
  // The hook has always exposed and set `loading`; this component never read it.
  // Deriving the key takes PBKDF2 at 600,000 iterations, plus a cold-worker wake
  // on top, so pressing Unlock changed nothing on screen for one to three
  // seconds — the single most-used gate in the product reading as dead. Enter
  // could also fire a second vault_unlock mid-flight, and a wrong password then
  // counted twice against the persisted brute-force guard.
  const busy = loading || isLockedOut;

  // Auto-unlock for "Never" mode vaults (encrypted with empty password)
  useEffect(() => {
    if (visible && !vault.autoLockEnabled && vault.locked) {
      rpc<boolean>('vault_unlock', { password: '' }).then((ok) => {
        if (ok) handleSuccess();
      }).catch(() => {});
    }
  }, [visible, vault.autoLockEnabled, vault.locked, handleSuccess]);

  const { shouldRender, animating } = useAnimatedVisible(visible);

  useEffect(() => {
    if (visible) {
      reset();
      focus();
      setConfirmReset(false);
    }
  }, [visible, reset, focus]);

  const handleCancelAll = async () => {
    await rpc('signer_cancelUnlockWaiters');
    reset();
    onCancel?.();
  };

  const handleCancelOne = async (id: string) => {
    await rpc('signer_cancelUnlockWaiter', { id });
  };

  const handleDestroyVault = async () => {
    await rpc('vault_destroy');
    vault.checkState();
    window.location.reload();
  };

  if (!shouldRender) return null;

  return (
    <div
      className={[
        'animate-backdrop-in',
        'absolute inset-0 z-lock bg-[rgba(0,0,0,0.3)] backdrop-blur-sm flex items-center justify-center p-12',
        fullScreen ? 'bg-scrim-heavy backdrop-blur-[20px]' : '',
        animating ? 'animate-backdrop-out' : '',
      ].join(' ')}
    >
      <div
        className={[
          'animate-modal-fade-in',
          'bg-elevated border border-card-border rounded-[14px] p-12 w-full max-w-[320px]',
          fullScreen ? 'bg-glass-heavy shadow-[0_8px_40px_rgba(0,0,0,0.2)]' : '',
          animating ? 'animate-modal-fade-out' : '',
        ].join(' ')}
      >
        <div className="flex flex-col items-center gap-4 mb-8">
          <Avatar
            src={avatarUrl}
            fallback={initial}
            imgClassName="size-24 rounded-full object-cover"
            fallbackClassName="size-24 rounded-full bg-[rgba(99,102,241,0.2)] flex items-center justify-center text-3xl font-semibold text-secondary"
          />
          <div className="text-lg font-semibold text-heading">{displayName}</div>
        </div>
        <div className="text-sm text-secondary text-center mb-8">{message || t('unlock.vaultLocked')}</div>
        <input
          ref={inputRef}
          type="password"
          className="w-full py-5 px-6 text-md bg-brand-tint-hover border border-card-active rounded-md text-heading mb-4 box-border focus:outline-none focus:border-[rgba(99,102,241,0.5)]"
          placeholder={t('unlock.enterPassword')}
          value={password}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && !busy && unlock()}
          autoComplete="off"
          disabled={busy}
        />
        <FormError>{error}</FormError>
        {unlockWaiters && unlockWaiters.length > 0 && (
          <div className="w-full mt-4 flex flex-col gap-2">
            <div className="text-xs text-muted uppercase tracking-[0.5px] mb-1">{t('unlock.pendingEvents')}</div>
            {unlockWaiters.map((w) => (
              <div key={w.id} className="flex items-center gap-3 py-2 px-4 bg-brand-tint-hover rounded-sm text-sm">
                <span className="font-medium text-heading">{getEventLabel(w.type)}</span>
                <span className="text-muted flex-1 text-right overflow-hidden text-ellipsis">{w.origin}</span>
                <IconButton
                  tone="danger"
                  size={20}
                  onClick={() => handleCancelOne(w.id)}
                  aria-label={t('common.close')}
                >
                  <IconClose size={12} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-4 mt-4">
          {onCancel && (
            <Button
              variant="secondary"
              small
              className="flex-1"
              onClick={handleCancelAll}
            >
              {t('common.cancel')}
            </Button>
          )}
          <Button className="flex-1" small onClick={unlock} disabled={busy}>
            {loading ? t('common.loading') : t('common.unlock')}
          </Button>
        </div>
        {fullScreen && !confirmReset && (
          <LinkButton className="block w-full mt-6 text-center hover:text-error" onClick={() => setConfirmReset(true)}>
            {t('unlock.forgotPassword')}
          </LinkButton>
        )}
        {fullScreen && confirmReset && (
          <div className="mt-6 p-6 bg-[rgba(239,68,68,0.06)] border border-[rgba(239,68,68,0.2)] rounded-md">
            <p className="text-xs text-error mb-5 leading-normal">{t('unlock.resetWarning')}</p>
            <div className="flex gap-4">
              <Button variant="secondary" small className="flex-1" onClick={() => setConfirmReset(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" small className="flex-1" onClick={handleDestroyVault}>
                {t('unlock.resetVault')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
