import { t } from '@services/i18n/i18n.ts';
import Button from '@components/Button/Button';
import Card from '@components/Card/Card';
import FieldDisplay from '@components/FieldDisplay/FieldDisplay';
import Heading from '@components/Heading/Heading';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

interface DoneAccount {
  name?: string;
  type: string;
  pubkey?: string;
}

interface DoneStepProps {
  account: DoneAccount | null;
  onDone: () => void;
}

export default function DoneStep({ account, onDone }: DoneStepProps) {
  return (
    <Container className="flex-1">
      <Heading className="mb-3">{t('wizard.yourAllSet')}</Heading>
      <Text variant="secondary" className="mb-8">
        {t('wizard.identityReady')}
      </Text>

      {account && (
        <Card variant="flat">
          {account.name && <FieldDisplay divided label={t('wizard.nameLabel')} value={account.name} />}
          <FieldDisplay divided label={t('wizard.typeLabel')} value={t(`wizard.type.${account.type}`)} />
          <FieldDisplay
            divided
            label={t('wizard.publicKeyLabel')}
            value={`${account.pubkey?.slice(0, 12)}...${account.pubkey?.slice(-12)}`}
          />
        </Card>
      )}

      <Container variant="row" gap={4} stickyFooter>
        <Button className="flex-1" onClick={onDone}>{t('wizard.getStarted')}</Button>
      </Container>
    </Container>
  );
}
