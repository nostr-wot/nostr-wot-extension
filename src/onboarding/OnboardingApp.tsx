import { rpcNotify } from '@services/rpc.ts';
import { t } from '@lib/i18n.js';
import '@styles/tailwind.css';
import TopoBg from '@components/TopoBg/TopoBg';
import PulseLogo from '@components/PulseLogo/PulseLogo';
import Button from '@components/Button/Button';
import useWizardFlow from '@hooks/useWizardFlow.ts';
import WizardSteps from '@wizard/WizardSteps';
import Heading from '@components/Heading/Heading';

export default function OnboardingApp() {
  const flow = useWizardFlow({ initialStep: 'welcome' });

  const handleDone = () => { rpcNotify('configUpdated'); window.close(); };

  if (flow.step === 'welcome') {
    return (
      <div className="min-h-screen bg-surface">
        <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
          <TopoBg />
          <div className="relative z-[1] flex flex-col items-center text-center gap-6 max-w-[400px] p-12">
            <PulseLogo />
            <Heading level={1} className="m-0">{t('onboarding.title')}</Heading>
            <p className="text-xl text-secondary leading-loose m-0">{t('onboarding.subtitle')}</p>
            <Button className="mt-8 py-7 px-20 rounded-lg text-2xl" onClick={() => flow.send('NEXT')}>
              {t('wizard.getStarted')}
            </Button>
          </div>
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
