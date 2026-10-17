import { DEFAULT_AUTO_LOCK_MS } from '@constants/vault.ts';
import { useState, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import { rpc, rpcRead } from '@services/rpc.ts';
import AutoLockOptions from '@components/AutoLockOptions';
import { changePasskeyProtection } from '@services/vault/protectionClient';
import { t } from '@services/i18n/i18n.ts';
import IconWarning from '@assets/IconWarning.tsx';
import IconLock from '@assets/IconLock.tsx';
import Card from '@components/Card';
import Input from '@components/Input';
import Button, { ButtonSecondary } from '@components/Button';
import ListRow from '@components/ListRow';
import PasswordPairFields from '@components/PasswordPairFields';
import usePasswordPair from '@hooks/usePasswordPair.ts';
import { useVault } from '@context/VaultContext';

import UnlockMethodSection from './UnlockMethodSection';
import FormError from '@components/FormError';
import Container from '@components/Container';
import StatusNotice from '@components/StatusNotice';
import Text from '@components/Text';

interface SecuritySectionProps {
  onChangePassword: () => void;
}

export default function SecuritySection({ onChangePassword }: SecuritySectionProps) {
  const [passkey, setPasskey] = useState<boolean | null>(null);
  const [autoLockMs, setAutoLockMs] = useState<number>(DEFAULT_AUTO_LOCK_MS);
  const [pendingMs, setPendingMs] = useState<number | null>(null);
  // The pair for "turning auto-lock on" (never → timed). Disabling it
  // (timed → never) asks for the *current* password instead, a single field
  // that is not part of any pair — kept separate on purpose.
  const pair = usePasswordPair();
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const vault = useVault();

  const refresh = () => {
    rpcRead('vault_getPasskey').then((metadata) => setPasskey(!!metadata)).catch(() => {});
    rpcRead<number>('vault_getAutoLock').then((ms) => {
      if (typeof ms === 'number') setAutoLockMs(ms);
    }).catch(() => {});
  };
  useEffect(refresh, []);

  const isNever = autoLockMs === 0;

  // Does this selection require password confirmation?
  const needsPassword = (ms: number): boolean => {
    if (passkey) return ms === 0;
    const wasNever = autoLockMs === 0;
    const willBeNever = ms === 0;
    return wasNever !== willBeNever;
  };

  const handleChipSelect = async (ms: number) => {
    if (loading) return;
    setError('');
    pair.reset();
    setCurrentPassword('');

    if (needsPassword(ms)) {
      // Show password fields, don't apply yet
      setPendingMs(ms);
    } else {
      // Same category (timed→timed), apply directly
      setPendingMs(null);
      setLoading(true);
      try { await rpc('vault_setAutoLock', { ms }); setAutoLockMs(ms); }
      catch (e) { setError((e as Error).message); }
      finally { setLoading(false); }
    }
  };

  const handleConfirm = async () => {
    if (pendingMs === null) return;
    const switchingToTimed = autoLockMs === 0 && pendingMs !== 0;
    const switchingToNever = autoLockMs !== 0 && pendingMs === 0;

    if (switchingToTimed && !pair.ready) return;
    if (switchingToNever && !passkey && !currentPassword) {
      setError(t('security.enterCurrentPassword')); return;
    }

    setLoading(true);
    setError('');

    try {
      const params: Record<string, any> = { ms: pendingMs };
      if (switchingToTimed) params.password = pair.password;
      if (switchingToNever) params.currentPassword = currentPassword;
      if (switchingToNever && passkey) await changePasskeyProtection('', 0);
      else await rpc('vault_setAutoLock', params);
      refresh();
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
          <AutoLockOptions value={displayMs} onChange={handleChipSelect} disabled={loading || vault.locked || passkey === null} />

          {vault.exists && displayMs !== 0 && passkey !== null && <UnlockMethodSection passkey={passkey} locked={vault.locked} neverLock={isNever} onChanged={() => { refresh(); void vault.checkState(); }} />}

          {pendingMs === null && <FormError>{error}</FormError>}
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
                <ButtonSecondary small onClick={handleCancel}>{t('common.cancel')}</ButtonSecondary>
                <Button small onClick={handleConfirm} disabled={loading || !pair.ready}>
                  {loading ? t('common.saving') : t('common.confirm')}
                </Button>
              </Container>
            </Container>
          )}

          {showCurrentPassword && (
            <Container gap={5} className="mt-6 pt-6 border-t border-brand-tint-active">
              <StatusNotice variant="callout" tone="warn" icon={<IconWarning />}>
                {t('security.neverLockWarning')}
              </StatusNotice>
              <Text variant="secondary" as="p" className="text-sm m-0">{t(passkey ? 'passkey.unlockDescription' : 'security.confirmPasswordHint')}</Text>
              {!passkey && <Input
                type="password"
                showToggle
                placeholder={t('security.currentPassword')}
                value={currentPassword}
                onChange={(e: ChangeEvent<HTMLInputElement>) => { setCurrentPassword(e.target.value); setError(''); }}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleConfirm()}
              />}
              <FormError>{error}</FormError>
              <Container variant="row" gap={4} className="justify-end">
                <ButtonSecondary small onClick={handleCancel}>{t('common.cancel')}</ButtonSecondary>
                <Button small onClick={handleConfirm} disabled={loading}>
                  {loading ? t('common.saving') : t('common.confirm')}
                </Button>
              </Container>
            </Container>
          )}
        </Card>
      )}


      {vault.exists && !vault.locked && !isNever && passkey === false && (
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
