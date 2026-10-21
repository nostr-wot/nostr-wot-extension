import { useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import type { PhysicalEntropyKind } from '@domain/accounts/physicalEntropy.ts';
import ExtensionPage from '@components/ExtensionPage';
import Button from '@components/Button';
import Container from '@components/Container';
import FormError from '@components/FormError';
import Heading from '@components/Heading';
import StatusNotice from '@components/StatusNotice';
import Text from '@components/Text';
import IconDice from '@assets/IconDice.tsx';
import EntropyGame from '@screens/EntropyGame';
import { keepWizardOnCreate, persistCreated } from '@screens/Wizard/createdPhrase.ts';

/**
 * The dice/coin game in its own tab: a hundred rolls do not fit a popup that
 * closes on the first click outside it. The finished phrase goes back to the
 * Create step through session storage and is never shown here.
 */
export default function EntropyApp() {
  const [done, setDone] = useState<PhysicalEntropyKind | null>(null);
  const [error, setError] = useState('');

  const complete = async (kind: PhysicalEntropyKind, results: number[]): Promise<boolean> => {
    setError('');
    try {
      // hideMnemonic: this page never holds the words; the Create step fetches them.
      const result = await rpc<{ account: { pubkey: string } }>('onboarding_generateAccount', { physical: { kind, results }, hideMnemonic: true });
      await persistCreated(result.account.pubkey, kind, true);
      await keepWizardOnCreate();
      setDone(kind);
      return true;
    } catch (e: any) {
      setError(e.message || t('wizard.failedGenerate'));
      return false;
    }
  };

  return <ExtensionPage>
    <Container gap={6}>
      <Heading>{t('entropyGame.title')}</Heading>
      {done ? <>
        <StatusNotice tone="ok" icon={<IconDice />}>{t(done === 'coin' ? 'entropyGame.readyCoin' : 'entropyGame.readyDice')}</StatusNotice>
        <Text variant="secondary">{t('entropyGame.returnToSetup')}</Text>
        <Button onClick={() => window.close()}>{t('entropyGame.closeTab')}</Button>
      </> : <>
        <Text variant="secondary">{t('entropyGame.pageIntro')}</Text>
        <EntropyGame onComplete={complete} />
        <FormError>{error}</FormError>
      </>}
    </Container>
  </ExtensionPage>;
}
