import { t } from '@services/i18n/i18n.ts';
import TopoBg from '@components/TopoBg';
import PulseLogo from '@components/PulseLogo';
import Button from '@components/Button';
import Heading from '@components/Heading';
import Container from '@components/Container';
import Text from '@components/Text';

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
            <Button className="mt-8" onClick={onStart}>
              {t('wizard.getStarted')}
            </Button>
          </Container>
        </div>
      </div>
    );
}
