import React, { useState, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import browser from '@lib/browser.ts';
import { rpc } from '@services/rpc.ts';
import { AUTO_LOCK_OPTIONS } from '@domain/vault/autoLock.ts';
import { t } from '@lib/i18n.js';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import ChipGroup from '@components/ChipGroup/ChipGroup';
import PasswordPairFields from '@components/PasswordPairFields/PasswordPairFields';
import usePasswordPair from '@hooks/usePasswordPair.ts';
import useVaultUnlock from '@hooks/useVaultUnlock.ts';
import { isVaultOpen } from '@domain/vault/vaultAutoUnlock.ts';
import FormError from '@components/FormError/FormError';
import Heading from '@components/Heading/Heading';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';

interface PasswordStepProps {
  account: any;
  upgradeId: string | null;
  onNext: (upgraded: boolean) => void;
}

export default function PasswordStep({ account, upgradeId, onNext }: PasswordStepProps) {
  const pair = usePasswordPair();
  const [autoLockMs, setAutoLockMs] = useState<number>(900000); // 15 min default
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [vaultExists, setVaultExists] = useState<boolean | null>(null); // null = checking
  const [needsUnlock, setNeedsUnlock] = useState(false);

  /**
   * The unlock form for the "vault exists, add this account to it" branch.
   *
   * Through the shared hook so it carries the escalating brute-force lockout.
   * It called vault_unlock directly, which made the add-account path an
   * unthrottled password oracle while every other unlock in the product was
   * throttled — including the one on the very next screen.
   */
  const unlockForm = useVaultUnlock({
    onSuccess: async () => {
      try {
        await rpc('onboarding_addToVault', {
          account,
          upgradeFromReadOnly: upgradeId || null,
        });
        onNext(!!upgradeId);
      } catch (e: unknown) {
        unlockForm.setError((e as Error).message || t('key.failedUnlock'));
      }
    },
    messages: {
      wrongPassword: t('key.wrongPassword'),
      unlockFailed: t('key.failedUnlock'),
    },
  });

  useEffect(() => {
    (async () => {
      try {
        const exists = await rpc<boolean>('vault_exists');
        if (!exists) { setVaultExists(false); return; }
        // Vault blob exists but may have no accounts (user removed all)
        // In that case, treat as new vault so user can set auto-lock
        const data: any = await browser.storage.local.get(['accounts']);
        const accts = data.accounts || [];
        if (accts.length === 0) { setVaultExists(false); return; }

        // Vault exists with accounts — auto-add without showing UI, if the
        // vault is open or can be opened without a password.
        if (!(await isVaultOpen(rpc))) { setNeedsUnlock(true); setVaultExists(true); return; }
        // Vault unlocked — add account and proceed
        await rpc('onboarding_addToVault', {
          account,
          upgradeFromReadOnly: upgradeId || null,
        });
        onNext(!!upgradeId);
      } catch {
        setVaultExists(false);
      }
    })();
  }, []);

  const isNever = autoLockMs === 0;

  const handleContinue = async () => {
    // Only validate password when creating a new vault
    if (!vaultExists && !isNever && !pair.ready) return;
    if (!account) { setError(t('wizard.noAccountData')); return; }

    setLoading(true);
    setError('');

    try {
      if (vaultExists) {
        // Add to existing vault -- does NOT overwrite
        await rpc('onboarding_addToVault', {
          account,
          upgradeFromReadOnly: upgradeId || null,
        });
      } else {
        // Create new vault
        await rpc('onboarding_createVault', {
          password: isNever ? '' : pair.password,
          account,
          autoLockMinutes: autoLockMs / 60000,
          upgradeFromReadOnly: upgradeId || null,
        });
      }

      onNext(!!upgradeId);
    } catch (e: any) {
      setError(e.message || t('wizard.failedCreateVault'));
    }
    setLoading(false);
  };

  // Still checking vault state
  if (vaultExists === null) return null;

  // Vault exists but locked — need password to unlock
  if (vaultExists && needsUnlock) {


    return (
      <div className="flex flex-col flex-1">
        <Heading className="mb-3">{t('wizard.addToVault')}</Heading>
        <p className="text-md text-secondary leading-normal mb-8">{t('unlock.vaultLocked')}</p>

        <div className="mb-6">
          <SectionLabel>{t('wizard.password')}</SectionLabel>
          <Input
            type="password"
            showToggle
            placeholder={t('unlock.enterPassword')}
            value={unlockForm.password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => unlockForm.setPassword(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && unlockForm.unlock()}
            autoFocus
          />
        </div>

        <FormError>{unlockForm.error}</FormError>

        <div className="flex gap-4 mt-auto py-8 sticky bottom-0 z-[1] [background:var(--bg-page)]">
          <Button className="flex-1" onClick={unlockForm.unlock} disabled={unlockForm.loading || !unlockForm.password}>
            {unlockForm.loading ? t('common.loading') : t('common.unlock')}
          </Button>
        </div>
      </div>
    );
  }

  // No vault -- full password setup
  return (
    <div className="flex flex-col flex-1">
      <Heading className="mb-3">{t('wizard.protectYourKeys')}</Heading>
      <p className="text-md text-secondary leading-normal mb-8">
        {t('wizard.protectYourKeysDesc')}
      </p>

      <div className="mb-6">
        <SectionLabel>{t('wizard.autoLockTimer')}</SectionLabel>
        <ChipGroup
          options={AUTO_LOCK_OPTIONS.map((opt: any) => ({ value: opt.ms, label: t(opt.labelKey) }))}
          value={autoLockMs}
          onChange={(v: number) => { setAutoLockMs(v); setError(''); }}
        />
      </div>

      {isNever && (
        <div className="flex items-start gap-4 py-5 px-6 bg-[rgba(217,119,6,0.06)] rounded-panel text-sm text-warning leading-normal mb-6">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>{t('wizard.neverLockWarning')}</span>
        </div>
      )}

      {!isNever && (
        <div className="flex flex-col gap-5 mb-6">
          <SectionLabel className="mb-0">{t('wizard.password')}</SectionLabel>
          <PasswordPairFields
            pair={pair}
            passwordPlaceholder={t('wizard.minEightChars')}
            confirmPlaceholder={t('wizard.reEnterPw')}
            onSubmit={handleContinue}
          />
        </div>
      )}

      <FormError>{error}</FormError>

      <div className="flex gap-4 mt-auto py-8 sticky bottom-0 z-[1] [background:var(--bg-page)]">
        <Button className="flex-1" onClick={handleContinue} disabled={loading || (!isNever && !pair.ready)}>
          {loading ? t('wizard.creatingVault') : t('common.continue')}
        </Button>
      </div>
    </div>
  );
}
