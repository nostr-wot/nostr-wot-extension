import { useState, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import useVaultUnlock from '@hooks/useVaultUnlock.ts';
import FormError from '@components/FormError/FormError';
import Heading from '@components/Heading/Heading';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import FieldDisplay from '@components/FieldDisplay/FieldDisplay';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

interface SubAccountStepProps {
  onNext: (account: any) => void;
}

export default function SubAccountStep({ onNext }: SubAccountStepProps) {
  const [account, setAccount] = useState<any>(null);
  const [derivationIndex, setDerivationIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [needsUnlock, setNeedsUnlock] = useState(false);
  // Through the shared hook, which carries the escalating brute-force lockout.
  // This form called vault_unlock directly, so the add-account path was an
  // unthrottled password oracle while every other unlock in the product was
  // throttled.
  const {
    password,
    setPassword,
    error: unlockError,
    loading: unlocking,
    unlock,
  } = useVaultUnlock({
    onSuccess: () => { void generate(); },
    messages: {
      wrongPassword: t('key.wrongPassword'),
      unlockFailed: t('key.failedUnlock'),
    },
  });

  const generate = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await rpc<{ account: any; derivationIndex: number }>('onboarding_generateSubAccount', {});
      setAccount(result.account);
      setDerivationIndex(result.derivationIndex);
      setNeedsUnlock(false);
    } catch (e: any) {
      const msg = e.message || '';
      if (msg.includes('locked')) {
        setNeedsUnlock(true);
      } else {
        setError(msg || t('wizard.failedGenerate'));
      }
    }
    setLoading(false);
  };

  useEffect(() => { void generate(); }, []);

  const handleContinue = async () => {
    if (!account) return;
    setSaving(true);
    setError('');
    try {
      await rpc('onboarding_addToVault', { account, upgradeFromReadOnly: null });
      onNext(account);
    } catch (e: any) {
      setError(e.message || t('wizard.failedCreateVault'));
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Container className="flex-1">
        <Heading className="mb-3">{t('wizard.generatingIdentity')}</Heading>
        <Text variant="secondary" className="mb-8">{t('wizard.creatingKeypair')}</Text>
      </Container>
    );
  }

  if (needsUnlock) {
    return (
      <Container className="flex-1">
        <Heading className="mb-3">{t('wizard.subAccountTitle')}</Heading>
        <Text variant="secondary" className="mb-8">{t('unlock.vaultLocked')}</Text>

        <div className="mb-6">
          <SectionLabel>{t('wizard.password')}</SectionLabel>
          <Input
            type="password"
            showToggle
            placeholder={t('unlock.enterPassword')}
            value={password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && unlock()}
            autoFocus
          />
        </div>

        <FormError>{unlockError}</FormError>

        <Container variant="row" gap={4} stickyFooter>
          <Button className="flex-1" onClick={unlock} disabled={unlocking || !password}>
            {unlocking ? t('common.loading') : t('common.unlock')}
          </Button>
        </Container>
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="flex-1">
        <Heading className="mb-3">{t('common.error')}</Heading>
        <FormError>{error}</FormError>
      </Container>
    );
  }

  return (
    <Container className="flex-1">
      <Heading className="mb-3">{t('wizard.subAccountTitle')}</Heading>
      <Text variant="secondary" className="mb-8">
        {t('wizard.subAccountDesc')}
      </Text>

      <Container gap={4} className="bg-surface border border-card-border rounded-panel py-6 px-7 mb-6">
        <FieldDisplay className="py-0" label={t('wizard.typeLabel')} value={t('wizard.subAccountType')} />
        <FieldDisplay
          className="py-0"
          mono
          label={t('wizard.derivationPath')}
          value={`m/44'/1237'/0'/0/${derivationIndex}`}
        />
        {account?.pubkey && (
          <FieldDisplay
            className="py-0"
            mono
            label={t('wizard.publicKeyLabel')}
            value={`${account.pubkey.slice(0, 12)}...${account.pubkey.slice(-8)}`}
          />
        )}
      </Container>

      <Text variant="muted" className="text-sm mb-4">
        {t('wizard.subAccountHint')}
      </Text>

      <Container variant="row" gap={4} stickyFooter>
        <Button className="flex-1" onClick={handleContinue} disabled={saving}>
          {saving ? t('wizard.addingAccount') : t('common.continue')}
        </Button>
      </Container>
    </Container>
  );
}
