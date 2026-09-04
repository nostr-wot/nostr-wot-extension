import { useState, ChangeEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@lib/i18n.js';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import FormError from '@components/FormError/FormError';
import Heading from '@components/Heading/Heading';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

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
    <Container className="flex-1">
      <Heading className="mb-3">{t('wizard.npubTitle')}</Heading>
      <Text variant="secondary" className="mb-8">
        {t('wizard.npubDesc')}
      </Text>

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

      <Container variant="row" gap={4} stickyFooter>
        <Button className="flex-1" onClick={handleContinue} disabled={!input.trim() || loading}>
          {loading ? t('wizard.validating') : t('common.continue')}
        </Button>
      </Container>
    </Container>
  );
}
