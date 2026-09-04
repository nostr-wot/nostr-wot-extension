import { rpcNotify } from '@services/rpc.ts';
import { t } from '@lib/i18n.js';
import '@styles/tailwind.css';
import TopoBg from '@components/TopoBg/TopoBg';
import PulseLogo from '@components/PulseLogo/PulseLogo';
import Button from '@components/Button/Button';
import useWizardFlow from '@hooks/useWizardFlow.ts';
import WizardSteps from '@wizard/WizardSteps';
import Heading from '@components/Heading/Heading';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

export default function OnboardingApp() {
  const flow = useWizardFlow({ initialStep: 'welcome' });

  const handleDone = () => { rpcNotify('configUpdated'); window.close(); };

  if (flow.step === 'welcome') {
    return (
      <div className="min-h-screen bg-surface">
        <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
          <TopoBg />
          <Container gap={6} className="relative z-[1] items-center text-center max-w-[400px] p-12">
            <PulseLogo />
            <Heading level={1} className="m-0">{t('onboarding.title')}</Heading>
            <Text variant="secondary" className="text-xl leading-loose m-0">{t('onboarding.subtitle')}</Text>
            <Button className="mt-8 py-7 px-20 rounded-lg text-2xl" onClick={() => flow.send('NEXT')}>
              {t('wizard.getStarted')}
            </Button>
          </Container>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-[480px] mx-auto min-h-screen flex flex-col">
        <WizardSteps flow={flow} onDone={handleDone} onClose={null} onLangSelect={() => flow.send('NEXT')} bodyClassName="py-12 px-10" />
      </div>
    </div>
  );
}
