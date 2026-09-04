import { useState, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { AUTO_LOCK_OPTIONS } from '@domain/vault/autoLock.ts';
import { t } from '@lib/i18n.js';
import { IconLock } from '@assets';
import Card from '@components/Card/Card';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import ChipGroup from '@components/ChipGroup/ChipGroup';
import ListRow from '@components/ListRow/ListRow';
import { SectionLabel, SectionHint } from '@components/SectionLabel/SectionLabel';
import PasswordPairFields from '@components/PasswordPairFields/PasswordPairFields';
import usePasswordPair from '@hooks/usePasswordPair.ts';
import { useVault } from '@context/VaultContext';

import FormError from '@components/FormError/FormError';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

interface SecuritySectionProps {
  onChangePassword: () => void;
}

export default function SecuritySection({ onChangePassword }: SecuritySectionProps) {
  const [autoLockMs, setAutoLockMs] = useState<number>(900000);
  const [pendingMs, setPendingMs] = useState<number | null>(null);
  // The pair for "turning auto-lock on" (never → timed). Disabling it
  // (timed → never) asks for the *current* password instead, a single field
  // that is not part of any pair — kept separate on purpose.
  const pair = usePasswordPair();
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const vault = useVault();

  useEffect(() => {
    rpc<number>('vault_getAutoLock').then((ms) => {
      if (typeof ms === 'number') setAutoLockMs(ms);
    }).catch(() => {});
  }, []);

  const isNever = autoLockMs === 0;

  // Does this selection require password confirmation?
  const needsPassword = (ms: number): boolean => {
    const wasNever = autoLockMs === 0;
    const willBeNever = ms === 0;
    return wasNever !== willBeNever;
  };

  const handleChipSelect = (ms: number) => {
    setError('');
    pair.reset();
    setCurrentPassword('');

    if (needsPassword(ms)) {
      // Show password fields, don't apply yet
      setPendingMs(ms);
    } else {
      // Same category (timed→timed), apply directly
      setPendingMs(null);
      setAutoLockMs(ms);
      void rpc('vault_setAutoLock', { ms });
    }
  };

  const handleConfirm = async () => {
    if (pendingMs === null) return;
    const switchingToTimed = autoLockMs === 0 && pendingMs !== 0;
    const switchingToNever = autoLockMs !== 0 && pendingMs === 0;

    if (switchingToTimed && !pair.ready) return;
    if (switchingToNever && !currentPassword) {
      setError(t('security.enterCurrentPassword')); return;
    }

    setLoading(true);
    setError('');

    try {
      const params: Record<string, any> = { ms: pendingMs };
      if (switchingToTimed) params.password = pair.password;
      if (switchingToNever) params.currentPassword = currentPassword;
      await rpc('vault_setAutoLock', params);
      setAutoLockMs(pendingMs);
      setPendingMs(null);
      pair.reset();
      setCurrentPassword('');
      void vault.checkState?.();
    } catch (e: any) {
      setError(e.message || t('common.error'));
    }
    setLoading(false);
  };

  const handleCancel = () => {
    setPendingMs(null);
    pair.reset();
    setCurrentPassword('');
    setError('');
  };

  // The currently "displayed" selection — pending overrides actual
  const displayMs = pendingMs !== null ? pendingMs : autoLockMs;

  // Determine which password fields to show
  const showSetPassword = pendingMs !== null && isNever && pendingMs !== 0;
  const showCurrentPassword = pendingMs !== null && !isNever && pendingMs === 0;

  return (
    <Container gap={4} className="flex-1 py-2">
      {vault.exists && (
        <Card>
          <SectionLabel>{t('security.autoLock')}</SectionLabel>
          <SectionHint>{t('security.autoLockDesc')}</SectionHint>
          <ChipGroup
            options={AUTO_LOCK_OPTIONS.map((opt: any) => ({ value: opt.ms, label: t(opt.labelKey) }))}
            value={displayMs}
            onChange={handleChipSelect}
          />

          {showSetPassword && (
            <Container gap={5} className="mt-6 pt-6 border-t border-brand-tint-active">
              <Text variant="secondary" as="p" className="text-sm m-0">{t('security.setPasswordHint')}</Text>
              <PasswordPairFields
                pair={pair}
                passwordPlaceholder={t('wizard.minEightChars')}
                confirmPlaceholder={t('wizard.reEnterPw')}
                onSubmit={handleConfirm}
                disabled={loading}
              />
              <FormError>{error}</FormError>
              <Container variant="row" gap={4} className="justify-end">
                <Button variant="secondary" small onClick={handleCancel}>{t('common.cancel')}</Button>
                <Button small onClick={handleConfirm} disabled={loading || !pair.ready}>
                  {loading ? t('common.saving') : t('common.confirm')}
                </Button>
              </Container>
            </Container>
          )}

          {showCurrentPassword && (
            <Container gap={5} className="mt-6 pt-6 border-t border-brand-tint-active">
              <div className="flex items-start gap-4 py-5 px-6 bg-[rgb(217_119_6_/_0.06)] rounded-panel text-sm text-warning leading-normal">
                <svg className="shrink-0 mt-px" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>{t('security.neverLockWarning')}</span>
              </div>
              <Text variant="secondary" as="p" className="text-sm m-0">{t('security.confirmPasswordHint')}</Text>
              <Input
                type="password"
                showToggle
                placeholder={t('security.currentPassword')}
                value={currentPassword}
                onChange={(e: ChangeEvent<HTMLInputElement>) => { setCurrentPassword(e.target.value); setError(''); }}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleConfirm()}
              />
              <FormError>{error}</FormError>
              <Container variant="row" gap={4} className="justify-end">
                <Button variant="secondary" small onClick={handleCancel}>{t('common.cancel')}</Button>
                <Button small onClick={handleConfirm} disabled={loading}>
                  {loading ? t('common.saving') : t('common.confirm')}
                </Button>
              </Container>
            </Container>
          )}
        </Card>
      )}

      {vault.exists && !vault.locked && !isNever && (
        <ListRow
          variant="standalone"
          leadingChip={false}
          leading={
            <IconLock />
          }
          title={t('security.changePassword')}
          subtitle={t('security.changePasswordDesc')}
          onClick={onChangePassword}
        />
      )}
    </Container>
  );
}
