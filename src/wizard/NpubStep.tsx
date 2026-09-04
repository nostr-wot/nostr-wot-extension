import React, { useState, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import FormError from '@components/FormError/FormError';
import Heading from '@components/Heading/Heading';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';

interface NpubStepProps {
  onNext: (account: any) => void;
}

export default function NpubStep({ onNext }: NpubStepProps) {
  const [input, setInput] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const handleContinue = async () => {
    const val = input.trim();
    if (!val) { setError(t('wizard.enterPublicKey')); return; }

    setLoading(true);
    setError('');

    try {
      const result = await rpc<{ account: any }>('onboarding_validateNpub', { input: val });

      // Save read-only account
      await rpc('onboarding_saveReadOnly', { account: result.account });

      onNext(result.account);
    } catch (e: any) {
      setError(e.message || t('wizard.invalidPublicKey'));
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col flex-1">
      <Heading className="mb-3">{t('wizard.npubTitle')}</Heading>
      <p className="text-md text-secondary leading-normal mb-8">
        {t('wizard.npubDesc')}
      </p>

      <div className="mb-6">
        <SectionLabel>{t('wizard.npubLabel')}</SectionLabel>
        <Input
          mono
          placeholder={t('wizard.npubPlaceholder')}
          value={input}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { setInput(e.target.value); setError(''); }}
        />
      </div>

      <FormError>{error}</FormError>

      <div className="flex gap-4 mt-auto py-8 sticky bottom-0 z-[1] [background:var(--bg-page)]">
        <Button className="flex-1" onClick={handleContinue} disabled={!input.trim() || loading}>
          {loading ? t('wizard.validating') : t('common.continue')}
        </Button>
      </div>
    </div>
  );
}
