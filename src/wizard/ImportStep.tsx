import React, { useState, useEffect, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { IconInfo } from '@assets';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import FormError from '@components/FormError/FormError';

type ImportType = 'ncryptsec' | 'nsec' | 'mnemonic' | null;

function detectType(val: string): ImportType {
  if (val.startsWith('ncryptsec1')) return 'ncryptsec';
  if (val.startsWith('nsec1') || /^[0-9a-f]{64}$/i.test(val)) return 'nsec';
  // Check for 12 or 24 word mnemonic (words separated by spaces)
  const words = val.split(/\s+/).filter(Boolean);
  if (words.length === 12 || words.length === 24) return 'mnemonic';
  return null;
}

function wordCount(val: string): number {
  return val.split(/\s+/).filter(Boolean).length;
}

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

  const importType = detectType(input.trim());

  const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    setError('');
    setPubkey('');
    setUpgradeNotice('');

    const type = detectType(val.trim());
    if (type === 'ncryptsec') {
      setTypeHint(t('wizard.encryptedDetected'));
    } else if (type === 'nsec') {
      setTypeHint(t('wizard.privateKeyDetected'));
    } else if (type === 'mnemonic') {
      setTypeHint(t('wizard.seedDetected', { count: String(wordCount(val.trim())) }));
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
    <div className="flex flex-col flex-1">
      <h2 className="text-3xl font-bold text-heading mb-3">{t('wizard.importTitle')}</h2>
      <p className="text-md text-secondary leading-normal mb-8">
        {t('wizard.importDesc')}
      </p>

      <div className="mb-6">
        <label className="block text-sm font-semibold text-secondary mb-3">{t('wizard.importLabel')}</label>
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
            <label className="block text-sm font-semibold text-secondary mb-3">{t('wizard.decryptionPassword')}</label>
            <Input
              type="password"
              showToggle
              placeholder={t('wizard.encPasswordUsed')}
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            />
          </div>
          <div className="mb-6">
            <label className="block text-sm font-semibold text-secondary mb-3">{t('wizard.accountName')}</label>
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
          <div className="flex items-center gap-4 py-2">
            <label className="text-xs font-semibold text-muted min-w-[50px]">{t('wizard.pubkey')}</label>
            <span className="text-xs font-mono text-heading overflow-hidden text-ellipsis whitespace-nowrap">{pubkey.slice(0, 16)}...{pubkey.slice(-8)}</span>
          </div>
        </div>
      )}

      {upgradeNotice && <div className="py-4 px-6 bg-[rgba(37,99,235,0.06)] rounded-md text-xs text-info mt-4">{upgradeNotice}</div>}
      <FormError>{error}</FormError>

      <div className="flex gap-4 mt-auto py-8 sticky bottom-0 z-[1] [background:var(--bg-page)]">
        <Button className="flex-1" onClick={handleContinue} disabled={!input.trim() || loading}>
          {loading ? t('wizard.importing') : importType === 'ncryptsec' ? t('wizard.decryptContinue') : t('common.continue')}
        </Button>
      </div>
    </div>
  );
}
