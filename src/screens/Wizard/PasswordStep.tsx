import Toggle from '@components/Toggle';
import AutoLockOptions from '@components/AutoLockOptions';
import Card from '@components/Card';
import PasskeySelector from '@components/PasskeySelector';
import { DEFAULT_AUTO_LOCK_MS } from '@constants/vault.ts';
import IconWarning from '@assets/IconWarning.tsx';
import StatusNotice from '@components/StatusNotice';
import { useState, useEffect, useRef, ChangeEvent, KeyboardEvent } from 'react';
import browser from '@lib/browser.ts';
import { rpc, rpcRead } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import Input from '@components/Input';
import Button from '@components/Button';
import PasswordPairFields from '@components/PasswordPairFields';
import usePasswordPair from '@hooks/usePasswordPair.ts';
import useVaultUnlock from '@hooks/useVaultUnlock.ts';
import { isVaultOpen } from '@domain/vault/vaultAutoUnlock.ts';
import FormError from '@components/FormError';
import Heading from '@components/Heading';
import { SectionLabel } from '@components/SectionLabel';
import Container from '@components/Container';
import Text from '@components/Text';

interface PasswordStepProps {
  configurePasskey?: boolean;
  account: any;
  upgradeId: string | null;
  onNext: (upgraded: boolean) => void;
}

export default function PasswordStep({ account, upgradeId, onNext, configurePasskey = false }: PasswordStepProps) {
  const pair = usePasswordPair();
  const [usePasskey, setUsePasskey] = useState(configurePasskey);
  const onNextRef = useRef(onNext);
  onNextRef.current = onNext;
  const [autoLockMs, setAutoLockMs] = useState<number>(DEFAULT_AUTO_LOCK_MS); // 15 min default
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [vaultExists, setVaultExists] = useState<boolean | null>(null); // null = checking
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [checkAttempt, setCheckAttempt] = useState(0);

  /**
   * The unlock form for the "vault exists, add this account to it" branch.
   *
   * Through the shared hook so it carries the escalating brute-force lockout.
   * It called vault_unlock directly, which made the add-account path an
   * unthrottled password oracle while every other unlock in the product was
   * throttled — including the one on the very next screen.
   */
  const unlockForm = useVaultUnlock({
    onSuccess: () => {
      void (async () => {
        try {
          await rpc('onboarding_addToVault', {
            account,
            upgradeFromReadOnly: upgradeId || null,
          });
          onNext(!!upgradeId);
        } catch (e: unknown) {
          unlockForm.setError((e as Error).message || t('key.failedUnlock'));
        }
      })();
    },
    messages: {
      wrongPassword: t('key.wrongPassword'),
      unlockFailed: t('key.failedUnlock'),
    },
  });

  useEffect(() => {
    if (configurePasskey) { setVaultExists(false); return; }
    let current = true;
    setVaultExists(null);
    setCheckError('');
    setNeedsUnlock(false);
    void (async () => {
      try {
        const exists = await rpcRead<boolean>('vault_exists');
        if (!current) return;
        if (typeof exists !== 'boolean') throw new Error(t('common.error'));
        if (!exists) { setVaultExists(false); return; }
        // Vault blob exists but may have no accounts (user removed all)
        // In that case, treat as new vault so user can set auto-lock
        const data: any = await browser.storage.local.get(['accounts']);
        if (!current) return;
        const accts = data.accounts || [];
        if (accts.length === 0) { setVaultExists(false); return; }

        // Vault exists with accounts — auto-add without showing UI, if the
        // vault is open or can be opened without a password.
        const open = await isVaultOpen(rpc);
        if (!current) return;
        if (!open) { setNeedsUnlock(true); setVaultExists(true); return; }
        // Vault unlocked — add account and proceed
        await rpc('onboarding_addToVault', {
          account,
          upgradeFromReadOnly: upgradeId || null,
        });
        if (current) onNextRef.current(!!upgradeId);
      } catch (error) {
        // A failed read or duplicate-account rejection is not an empty vault.
        // Never offer first-time protection settings on an unsuccessful check.
        if (current) setCheckError((error as Error).message || t('common.error'));
      }
    })();
    return () => { current = false; };
  }, [account, upgradeId, configurePasskey, checkAttempt]);

  const isNever = autoLockMs === 0;

  const handleContinue = async () => {
    // Only validate password when creating a new vault
    if (!vaultExists && !isNever && !usePasskey && !pair.ready) return;
    if (!account) { setError(t('wizard.noAccountData')); return; }

    setLoading(true);
    setError('');

    try {
      if (configurePasskey) {
        await rpc('onboarding_configurePasskeyProtection', {
          usePasskey: !isNever && usePasskey,
          password: isNever || usePasskey ? '' : pair.password,
          autoLockMs,
        });
      } else if (vaultExists) {
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

  if (checkError) return (
    <Container className="flex-1">
      <FormError>{checkError}</FormError>
      <Button onClick={() => setCheckAttempt(value => value + 1)}>{t('common.retry')}</Button>
    </Container>
  );

  // Still checking vault state
  if (vaultExists === null) return null;

  // Vault exists but locked — need password to unlock
  if (vaultExists && needsUnlock) {

    return (
      <Container className="flex-1">
        <Heading className="mb-3">{t('wizard.addToVault')}</Heading>
        <Text variant="secondary" className="mb-8">{t(unlockForm.passkey ? 'passkey.unlockDescription' : 'unlock.vaultLocked')}</Text>

        <PasskeySelector {...unlockForm.passkeySelection} />
        {!unlockForm.passkey && !unlockForm.checkingMethod && <div className="mb-6">
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
        </div>}

        <FormError>{unlockForm.error}</FormError>

        <Container variant="row" gap={4} stickyFooter>
          <Button className="flex-1" onClick={unlockForm.unlock} disabled={unlockForm.loading || unlockForm.checkingMethod || (!unlockForm.passkey && !unlockForm.password)}>
            {unlockForm.loading ? t('common.loading') : t(unlockForm.passkey ? 'passkey.unlock' : 'common.unlock')}
          </Button>
        </Container>
      </Container>
    );
  }

  // No vault -- full password setup
  return (
    <Container className="flex-1">
      <Text variant="secondary" className="mb-8">
        {t('wizard.protectYourAccountDesc')}
      </Text>

      <Card>
        <AutoLockOptions value={autoLockMs} onChange={value => { setAutoLockMs(value); setError(''); }} disabled={loading} />
        <Container gap={5} className="mt-6 pt-6 border-t border-brand-tint-active">
          {isNever && (
            <StatusNotice variant="callout" tone="warn" icon={<IconWarning />}>
              {t('wizard.neverLockWarning')}
            </StatusNotice>
          )}
          {!isNever && configurePasskey && <Container variant="row" className="justify-between">
            <Text>{t('security.usePasskey')}</Text>
            <Toggle checked={usePasskey} aria-label={t('security.usePasskey')} disabled={loading} onChange={() => { setUsePasskey(!usePasskey); pair.reset(); setError(''); }} />
          </Container>}
          {!isNever && !usePasskey && <>
            <SectionLabel className="mb-0">{t('wizard.password')}</SectionLabel>
            <PasswordPairFields
              pair={pair}
              passwordPlaceholder={t('wizard.minEightChars')}
              confirmPlaceholder={t('wizard.reEnterPw')}
              onSubmit={handleContinue}
            />
          </>}
        </Container>
      </Card>

      <FormError>{error}</FormError>

      <Container variant="row" gap={4} stickyFooter>
        <Button className="flex-1" onClick={handleContinue} disabled={loading || (!isNever && !usePasskey && !pair.ready)}>
          {loading ? t('common.loading') : t(configurePasskey ? 'common.confirm' : 'common.continue')}
        </Button>
      </Container>
    </Container>
  );
}
