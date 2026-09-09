import { detectImportType } from '@domain/accounts/importInput.ts';
import { countWords } from '@utils/text.ts';
import { useState, useEffect, ChangeEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import IconInfo from '@assets/IconInfo.tsx';
import Input from '@components/Input';
import Button from '@components/Button';
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
  const [input, setInput] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [typeHint, setTypeHint] = useState<string>('');
  const [pubkey, setPubkey] = useState<string>('');
  const [upgradeNotice, setUpgradeNotice] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [hasSeed, setHasSeed] = useState<boolean>(!!hasGeneratedAccount);

  // Check for existing seed on mount (more accurate than prop alone)
  useEffect(() => {
    rpc<{ hasSeed: boolean }>('onboarding_checkExistingSeed')
      .then(r => setHasSeed(!!r?.hasSeed))
      .catch(() => {});
  }, []);

  const importType = detectImportType(input.trim());

  const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    setError('');
    setPubkey('');
    setUpgradeNotice('');

    const type = detectImportType(val.trim());
    if (type === 'ncryptsec') {
      setTypeHint(t('wizard.encryptedDetected'));
    } else if (type === 'nsec') {
      setTypeHint(t('wizard.privateKeyDetected'));
    } else if (type === 'mnemonic') {
      setTypeHint(t('wizard.seedDetected', { count: String(countWords(val.trim())) }));
    } else if (val.trim()) {
      setTypeHint('');
    } else {
      setTypeHint('');
    }
  };

  const handleContinue = async () => {
    const val = input.trim();
    if (!val) { setError(t('wizard.enterKey')); return; }

    setLoading(true);
    setError('');

    try {
      if (importType === 'ncryptsec') {
        if (!password) { setError(t('wizard.enterDecryptPassword')); setLoading(false); return; }
        const result = await rpc<{ account: any; upgradeFromReadOnly?: string }>('onboarding_validateNcryptsec', { ncryptsec: val, password, name: name || undefined });
        onNext(result.account, result.upgradeFromReadOnly || null);
      } else if (importType === 'mnemonic') {
        const result = await rpc<{ account: any; upgradeFromReadOnly?: string; importedAsMain?: boolean }>('onboarding_validateMnemonic', { mnemonic: val });
        const acct = result.account;
        setPubkey(acct.pubkey);
        if (result.upgradeFromReadOnly) {
          setUpgradeNotice(t('wizard.upgradeNotice'));
        }
        onNext(acct, result.upgradeFromReadOnly || null);
      } else {
        const result = await rpc<{ account: any; upgradeFromReadOnly?: string }>('onboarding_validateNsec', { input: val });
        const acct = result.account;
        setPubkey(acct.pubkey);
        if (result.upgradeFromReadOnly) {
          setUpgradeNotice(t('wizard.upgradeNotice'));
        }
        onNext(acct, result.upgradeFromReadOnly || null);
      }
    } catch (e: any) {
      setError(e.message || t('wizard.importFailed'));
    }
    setLoading(false);
  };

  return (
    <Container className="flex-1">
      <Heading className="mb-3">{t('wizard.importTitle')}</Heading>
      <Text variant="secondary" className="mb-8">
        {t('wizard.importDesc')}
      </Text>

      <div className="mb-6">
        <SectionLabel>{t('wizard.importLabel')}</SectionLabel>
        <Input
          type="password"
          showToggle
          mono
          placeholder={t('wizard.importPlaceholder')}
          value={input}
          onChange={handleInputChange}
        />
        {typeHint && <div className="text-xs font-medium text-brand mt-2">{typeHint}</div>}
      </div>

      {importType === 'ncryptsec' && (
        <>
          <div className="mb-6">
            <SectionLabel>{t('wizard.decryptionPassword')}</SectionLabel>
            <Input
              type="password"
              showToggle
              placeholder={t('wizard.encPasswordUsed')}
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            />
          </div>
          <div className="mb-6">
            <SectionLabel>{t('wizard.accountName')}</SectionLabel>
            <Input
              placeholder={t('wizard.accountNamePlaceholder')}
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            />
          </div>
        </>
      )}

      {importType === 'mnemonic' && (
        <div className="flex items-start gap-4 py-4 px-6 bg-card rounded-md text-xs leading-normal text-secondary mb-4">
          <IconInfo size={14} className="shrink-0 text-brand mt-px" />
          <span>{hasSeed ? t('wizard.seedDerivedLegend') : t('wizard.seedMainLegend')}</span>
        </div>
      )}

      {pubkey && (
        <div className="py-5 px-7 bg-card border border-card-border rounded-panel mt-4">
          <Container variant="row" gap={4} className="py-2">
            <label className="text-xs font-semibold text-muted min-w-[50px]">{t('wizard.pubkey')}</label>
            <span className="text-xs font-mono text-heading overflow-hidden text-ellipsis whitespace-nowrap">{pubkey.slice(0, 16)}...{pubkey.slice(-8)}</span>
          </Container>
        </div>
      )}

      {upgradeNotice && <div className="py-4 px-6 bg-[rgba(37,99,235,0.06)] rounded-md text-xs text-info mt-4">{upgradeNotice}</div>}
      <FormError>{error}</FormError>

      <Container variant="row" gap={4} stickyFooter>
        <Button className="flex-1" onClick={handleContinue} disabled={!input.trim() || loading}>
          {loading ? t('wizard.importing') : importType === 'ncryptsec' ? t('wizard.decryptContinue') : t('common.continue')}
        </Button>
      </Container>
    </Container>
  );
}
