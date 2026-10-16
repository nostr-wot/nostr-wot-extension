import PasskeySelector from '@components/PasskeySelector';
import { useState, useEffect, useRef, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import Input from '@components/Input';
import Button from '@components/Button';
import LinkButton from '@components/LinkButton';
import useSubAccountPreview from '@hooks/useSubAccountPreview.ts';
import { npubEncode } from '@lib/crypto/bech32.ts';
import { normalizeDerivationPath, identifyDerivationPath } from '@domain/accounts/derivation.ts';
import type { SafeAccount } from '@domain/accounts/types.ts';
import useVaultUnlock from '@hooks/useVaultUnlock.ts';
import FormError from '@components/FormError';
import Heading from '@components/Heading';
import { SectionLabel } from '@components/SectionLabel';
import FieldDisplay from '@components/FieldDisplay';
import CopyButton from '@components/CopyButton';
import { truncateMiddle } from '@utils/format/text';
import Container from '@components/Container';
import Text from '@components/Text';

interface SubAccountStepProps {
  onNext: (account: SafeAccount) => void;
}

export default function SubAccountStep({ onNext }: SubAccountStepProps) {
  const { account, path, setPath, loading, error: previewError, needsUnlock, retry } = useSubAccountPreview();
  const [customPath, setCustomPath] = useState(false);
  const pathFields = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (customPath) pathFields.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [customPath]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const validPath = normalizeDerivationPath(path);
  const knownPath = identifyDerivationPath(path);
  // Through the shared hook, which carries the escalating brute-force lockout.
  // This form called vault_unlock directly, so the add-account path was an
  // unthrottled password oracle while every other unlock in the product was
  // throttled.
  const {
    passkeySelection,
    passkey,
    checkingMethod,
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
    if (!account || loading || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      await rpc('onboarding_addToVault', { account, name: account.name, upgradeFromReadOnly: null });
      onNext(account);
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
        <Text variant="secondary" className="mb-8">{t(passkey ? 'passkey.unlockDescription' : 'unlock.vaultLocked')}</Text>

        <PasskeySelector {...passkeySelection} />
        {!passkey && !checkingMethod && <div className="mb-6">
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
        </div>}

        <FormError>{unlockError}</FormError>

        <Container variant="row" gap={4} stickyFooter>
          <Button className="flex-1" onClick={unlock} disabled={unlocking || checkingMethod || (!passkey && !password)}>
            {unlocking ? t('common.loading') : t(passkey ? 'passkey.unlock' : 'common.unlock')}
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
        {loading && <Text variant="hint" role="status">{t('wizard.updatingPreview')}</Text>}
        {account?.pubkey && [['npub', npubEncode(account.pubkey)], ['hex', account.pubkey]].map(([label, value]) => (
          <FieldDisplay key={label} label={label} className="flex-col items-start gap-2 py-0" valueClassName="text-left text-brand text-xs font-mono"
            value={<span className="inline-flex items-center gap-3"><span title={value}>{truncateMiddle(value, 16, 12)}</span><CopyButton iconOnly value={value} label={`${t('common.copy')} ${label}`} /></span>} />
        ))}
        <LinkButton tone="brand" className="mt-4 self-start" aria-expanded={customPath} aria-controls="subaccount-custom-path" onClick={() => setCustomPath(!customPath)}>{t('wizard.customPath')}</LinkButton>
        {customPath && <div ref={pathFields} id="subaccount-custom-path" className="flex flex-col gap-3">
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
        </div>}
      </Container>

      <FormError>{error || previewError}</FormError>
      <Text variant="muted" className="text-sm mb-4">
        {t('wizard.subAccountHint')}
      </Text>

      <Container variant="row" gap={4} stickyFooter>
        <Button className="flex-1" onClick={handleContinue} disabled={saving || loading || !account}>
          {saving ? t('wizard.addingAccount') : t('common.continue')}
        </Button>
      </Container>
    </Container>
  );
}
