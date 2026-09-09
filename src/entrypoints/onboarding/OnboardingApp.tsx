import WelcomeStep from '@screens/Wizard/WelcomeStep';
import { rpcNotify } from '@services/rpc.ts';
import '@styles/tailwind.css';
import useWizardFlow from '@hooks/useWizardFlow.ts';
import WizardSteps from '@screens/Wizard/WizardSteps';

export default function OnboardingApp() {
  const flow = useWizardFlow({ initialStep: 'welcome' });

  const handleDone = () => { rpcNotify('configUpdated'); window.close(); };

  if (flow.step === 'welcome') {
    return <WelcomeStep onStart={() => flow.send('NEXT')} />;
  }

  return (
    <div className="min-h-screen bg-surface">
      <div className="max-w-[480px] mx-auto min-h-screen flex flex-col">
        <WizardSteps flow={flow} onDone={handleDone} onClose={null} onLangSelect={() => flow.send('NEXT')} bodyClassName="py-12 px-10" />
      </div>
    </div>
  );
}
