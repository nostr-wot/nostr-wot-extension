import { useState, useRef, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import Input from '@components/Input';
import Button from '@components/Button';
import DetailDisclosure from '@components/DetailDisclosure';
import useSubAccountPreview from '@hooks/useSubAccountPreview.ts';
import { MAX_ACCOUNT_NAME_LENGTH } from '@constants/accounts.ts';
import { npubEncode } from '@lib/crypto/bech32.ts';
import { normalizeDerivationPath, identifyDerivationPath } from '@domain/accounts/derivation.ts';
import type { SafeAccount } from '@domain/accounts/types.ts';
import useVaultUnlock from '@hooks/useVaultUnlock.ts';
import FormError from '@components/FormError';
import Heading from '@components/Heading';
import { SectionLabel } from '@components/SectionLabel';
import FieldDisplay from '@components/FieldDisplay';
import Container from '@components/Container';
import Text from '@components/Text';

interface SubAccountStepProps {
  onNext: (account: SafeAccount) => void;
}

export default function SubAccountStep({ onNext }: SubAccountStepProps) {
  const { account, path, setPath, seedName, loading, error: previewError, needsUnlock, retry } = useSubAccountPreview();
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const validPath = normalizeDerivationPath(path);
  const knownPath = identifyDerivationPath(path);
  const displayName = name ?? account?.name ?? '';
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
    onSuccess: () => { void retry(); },
    messages: {
      wrongPassword: t('key.wrongPassword'),
      unlockFailed: t('key.failedUnlock'),
    },
  });

  const handleContinue = async () => {
    if (!account || loading || pending.current || displayName.trim().length > MAX_ACCOUNT_NAME_LENGTH) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      const namedAccount = { ...account, name: displayName.trim() || account.name };
      await rpc('onboarding_addToVault', { account: namedAccount, name: namedAccount.name, upgradeFromReadOnly: null });
      onNext(namedAccount);
    } catch (e: any) {
      setError(e.message || t('wizard.failedCreateVault'));
      setSaving(false);
      pending.current = false;
    }
  };

  if (loading && !path) {
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


  return (
    <Container className="flex-1">
      <Heading className="mb-3">{t('wizard.subAccountTitle')}</Heading>
      <Text variant="secondary" className="mb-8">
        {t('wizard.subAccountDesc')}
      </Text>

      <Container gap={4} className="bg-surface border border-card-border rounded-panel py-6 px-7 mb-6">
        <Container gap={3}>
          <SectionLabel htmlFor="subaccount-name" inline>{t('wizard.accountName')}</SectionLabel>
          <Input id="subaccount-name" value={displayName} maxLength={MAX_ACCOUNT_NAME_LENGTH}
            placeholder={t('wizard.accountNamePlaceholder')} disabled={saving}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)} />
        </Container>
        {seedName && <FieldDisplay className="py-0" label={t('wizard.sourceSeed')} value={seedName} />}
        <DetailDisclosure label={t('common.advanced')}>
          <SectionLabel htmlFor="subaccount-path" inline>{t('wizard.derivationPath')}</SectionLabel>
          <Input id="subaccount-path" value={path} disabled={saving}
            aria-describedby="subaccount-path-hint"
            error={path && !validPath ? t('wizard.invalidDerivationPath') : undefined}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setPath(event.target.value);
              setError('');
            }} />
          <Text variant="hint">{t('wizard.customPathHint')}</Text>
          <Text id="subaccount-path-hint" variant="hint" role="status" aria-live="polite">
            {validPath && (knownPath
              ? t(knownPath.network === 'Nostr' ? 'wizard.nostrPathHint' : 'wizard.networkPathHint', knownPath)
              : t('wizard.unknownPathHint'))}
          </Text>
        </DetailDisclosure>
        {loading && <Text variant="hint" role="status">{t('wizard.updatingPreview')}</Text>}
        {account?.pubkey && <>
          <FieldDisplay mono label="npub" value={npubEncode(account.pubkey)} />
          <FieldDisplay mono label="hex" value={account.pubkey} />
        </>}
      </Container>

      <FormError>{error || previewError}</FormError>
      <Text variant="muted" className="text-sm mb-4">
        {t('wizard.subAccountHint')}
      </Text>

      <Container variant="row" gap={4} stickyFooter>
        <Button className="flex-1" onClick={handleContinue} disabled={saving || loading || !account || displayName.trim().length > MAX_ACCOUNT_NAME_LENGTH}>
          {saving ? t('wizard.addingAccount') : t('common.continue')}
        </Button>
      </Container>
    </Container>
  );
}
