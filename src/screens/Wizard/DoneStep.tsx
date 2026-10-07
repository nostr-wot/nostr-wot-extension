import { t } from '@services/i18n/i18n.ts';
import Button from '@components/Button';
import CopyButton from '@components/CopyButton';
import { truncateMiddle } from '@utils/format/text';
import Heading from '@components/Heading';
import Container from '@components/Container';
import Text from '@components/Text';

interface DoneAccount {
  name?: string;
  type: string;
  pubkey?: string;
}

interface DoneStepProps {
  account: DoneAccount | null;
  onDone: () => void;
  derived?: boolean;
}

export default function DoneStep({ account, onDone, derived = false }: DoneStepProps) {
  return (
    <Container className="flex-1 justify-end pb-8">
      <Heading className="mb-3">{t('wizard.yourAllSet')}</Heading>
      <Text variant="secondary" className="mb-8">
        {t('wizard.identityReady')}
      </Text>

      {account && <Text className="text-brand mb-6">
        {t(derived ? 'wizard.doneDerivedSummary' : 'wizard.doneAccountSummary', { name: account.name || t(`wizard.type.${account.type}`) })}{' '}
        {account.pubkey && <span className="inline-flex items-center gap-3 text-xs font-mono">
          <span title={account.pubkey}>{truncateMiddle(account.pubkey, 12, 12)}</span>
          <CopyButton iconOnly value={account.pubkey} label={`${t('common.copy')} ${t('wizard.publicKeyLabel')}`} />
        </span>}
      </Text>}
      <Button className="w-full" onClick={onDone}>{t('wizard.getStarted')}</Button>

    </Container>
  );
}
