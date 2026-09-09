import { t } from '@services/i18n/i18n.ts';
import TopoBg from '@components/TopoBg/TopoBg';
import PulseLogo from '@components/PulseLogo/PulseLogo';
import Button from '@components/Button/Button';
import Heading from '@components/Heading/Heading';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

/** Welcome content shared independently of its browser document. */
export default function WelcomeStep({ onStart }: { onStart: () => void }) {
    return (
      <div className="min-h-screen bg-surface">
        <div className="relative min-h-screen flex items-center justify-center overflow-hidden">
          <TopoBg />
          <Container gap={6} className="relative z-[1] items-center text-center max-w-[400px] p-12">
            <PulseLogo />
            <Heading level={1} className="m-0">{t('onboarding.title')}</Heading>
            <Text variant="secondary" className="text-xl leading-loose m-0">{t('onboarding.subtitle')}</Text>
            <Button className="mt-8 py-7 px-20 rounded-lg text-2xl" onClick={onStart}>
              {t('wizard.getStarted')}
            </Button>
          </Container>
        </div>
      </div>
    );
}
