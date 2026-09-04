import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import Card from '@components/Card/Card';
import FieldDisplay from '@components/FieldDisplay/FieldDisplay';
import Heading from '@components/Heading/Heading';

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
    <div className="flex flex-col flex-1">
      <Heading className="mb-3">{t('wizard.yourAllSet')}</Heading>
      <p className="text-md text-secondary leading-normal mb-8">
        {t('wizard.identityReady')}
      </p>

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

      <div className="flex gap-4 mt-auto py-8 sticky bottom-0 z-[1] [background:var(--bg-page)]">
        <Button className="flex-1" onClick={onDone}>{t('wizard.getStarted')}</Button>
      </div>
    </div>
  );
}
