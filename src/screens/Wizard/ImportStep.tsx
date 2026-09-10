import { detectImportType } from '@domain/accounts/importInput.ts';
import { countWords } from '@utils/text.ts';
import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import IconInfo from '@assets/IconInfo.tsx';
import Input from '@components/Input';
import Button, { ButtonSecondary } from '@components/Button';
import { decryptBackup, isEncryptedBackup } from '@lib/crypto/keyBackup.ts';
import useAsyncScope from '@hooks/useAsyncScope.ts';
import FormError from '@components/FormError';
import Heading from '@components/Heading';
import { SectionLabel } from '@components/SectionLabel';
import Container from '@components/Container';
import Text from '@components/Text';

interface ImportStepProps {
  onNext: (account: any, upgradeId: string | null) => void;
  hasGeneratedAccount?: boolean;
}

export default function ImportStep({ onNext, hasGeneratedAccount }: ImportStepProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const scope = useAsyncScope();
  const [input, setInput] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [typeHint, setTypeHint] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [hasSeed, setHasSeed] = useState<boolean>(!!hasGeneratedAccount);

  // Check for existing seed on mount (more accurate than prop alone)
  useEffect(() => {
    rpc<{ hasSeed: boolean }>('onboarding_checkExistingSeed')
      .then(r => setHasSeed(!!r?.hasSeed))
      .catch(() => {});
  }, []);

  const importType = detectImportType(input.trim());
  const encrypted = isEncryptedBackup(input);
  const needsPassword = encrypted || importType === 'ncryptsec';

  const updateInput = (val: string) => {
    scope.invalidate();
    setPassword('');
    setInput(val);
    setError('');

    const type = detectImportType(val.trim());
    if (type === 'ncryptsec' || isEncryptedBackup(val)) {
      setTypeHint(t('wizard.encryptedDetected'));
    } else if (type === 'nsec') {
      setTypeHint(t('wizard.privateKeyDetected'));
    } else if (type === 'mnemonic') {
      setTypeHint(t('wizard.seedDetected', { count: String(countWords(val.trim())) }));
    } else if (type === 'pqc') {
      setError(t('wizard.pqKeyRequiresAccount'));
      setTypeHint('');
    } else if (val.trim()) {
      setTypeHint('');
    } else {
      setTypeHint('');
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || loading) return;
    const current = scope.start();
    setLoading(true);
    try {
      const contents = await file.text();
      if (current()) updateInput(contents);
    } catch {
      if (current()) setError(t('pqc.importFileUnreadable'));
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    if (loading || !input.trim() || (needsPassword && !password)) return;
    const current = scope.start();
    setLoading(true);
    setError('');
    try {
      const val = (encrypted ? await decryptBackup(input, password) : input).trim();
      if (!current()) return;
      const type = detectImportType(val);
      if (type === 'pqc') throw new Error(t('wizard.pqKeyRequiresAccount'));
      if (!type) throw new Error(t('wizard.importFailed'));
      // A nested ncryptsec has its own password; return it to the ordinary
      // import form instead of incorrectly reusing the outer export password.
      if (encrypted && type === 'ncryptsec') {
        updateInput(val);
        return;
      }
      const result = type === 'ncryptsec'
        ? await rpc<{ account: any; upgradeFromReadOnly?: string }>('onboarding_validateNcryptsec', { ncryptsec: val, password, name: name || undefined })
        : type === 'mnemonic'
          ? await rpc<{ account: any; upgradeFromReadOnly?: string }>('onboarding_validateMnemonic', { mnemonic: val })
          : await rpc<{ account: any; upgradeFromReadOnly?: string }>('onboarding_validateNsec', { input: val });
      if (!current()) return;
      setInput('');
      setPassword('');
      onNext(result.account, result.upgradeFromReadOnly || null);
    } catch (e: any) {
      if (current()) setError(e.message || t('wizard.importFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container className="flex-1">
      <Heading className="mb-3">{t('wizard.importTitle')}</Heading>
      <Text variant="secondary" className="mb-8">
        {t('wizard.importDesc')}
      </Text>

      <div className="mb-6">
        <SectionLabel htmlFor="account-import-key">{t('wizard.importLabel')}</SectionLabel>
        <Input
          type="password"
          showToggle
          mono
          placeholder={t('wizard.importPlaceholder')}
          value={input}
          onChange={e => updateInput(e.target.value)}
          disabled={loading}
          autoComplete="off"
          id="account-import-key"
        />
        {typeHint && <div className="text-xs font-medium text-brand mt-2">{typeHint}</div>}
      </div>

      <Container className="mb-6">
        <ButtonSecondary small onClick={() => fileRef.current?.click()} disabled={loading}>
          {t('pqc.importChooseFile')}
        </ButtonSecondary>
        <input ref={fileRef} type="file" accept="application/json,.json,.txt,text/plain" onChange={onFile} disabled={loading} hidden />
      </Container>

      {needsPassword && (
        <>
          <div className="mb-6">
            <SectionLabel htmlFor="account-import-password">{t('wizard.decryptionPassword')}</SectionLabel>
            <Input
              type="password"
              showToggle
              id="account-import-password"
              autoComplete="off"
              disabled={loading}
              placeholder={t('wizard.encPasswordUsed')}
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            />
          </div>
          {importType === 'ncryptsec' && <div className="mb-6">
            <SectionLabel>{t('wizard.accountName')}</SectionLabel>
            <Input
              placeholder={t('wizard.accountNamePlaceholder')}
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              disabled={loading}
            />
          </div>}
        </>
      )}

      {importType === 'mnemonic' && (
        <div className="flex items-start gap-4 py-4 px-6 bg-card rounded-md text-xs leading-normal text-secondary mb-4">
          <IconInfo size={14} className="shrink-0 text-brand mt-px" />
          <span>{hasSeed ? t('wizard.seedDerivedLegend') : t('wizard.seedMainLegend')}</span>
        </div>
      )}

      <FormError>{error}</FormError>

      <Container variant="row" gap={4} stickyFooter>
        <Button className="flex-1" onClick={handleContinue} disabled={!input.trim() || loading || (needsPassword && !password) || importType === 'pqc' || (!encrypted && !importType)}>
          {loading ? t('wizard.importing') : needsPassword ? t('wizard.decryptContinue') : t('common.continue')}
        </Button>
      </Container>
    </Container>
  );
}
