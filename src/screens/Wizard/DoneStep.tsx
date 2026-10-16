import { useEffect, useRef } from 'react';
import { t } from '@services/i18n/i18n.ts';
import Modal from '@components/Modal';
import Text from '@components/Text';
import { truncateMiddle } from '@utils/format/text';

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

/** How long the "all set" confirmation stays up before closing on its own. */
export const DONE_NOTICE_MS = 3000;

/** A centered confirmation that the account is ready, closing itself after three seconds. */
export default function DoneStep({ account, onDone, derived = false }: DoneStepProps) {
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const timer = setTimeout(() => onDoneRef.current(), DONE_NOTICE_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Modal title={t('wizard.yourAllSet')} onClose={onDone} maxWidth={340} zIndex={800}>
      <Text variant="secondary" className="mb-6">{t('wizard.identityReady')}</Text>
      {account && <Text className="text-brand m-0">
        {t(derived ? 'wizard.doneDerivedSummary' : 'wizard.doneAccountSummary', { name: account.name || t(`wizard.type.${account.type}`) })}{' '}
        {account.pubkey && <span className="text-xs font-mono" title={account.pubkey}>{truncateMiddle(account.pubkey, 12, 12)}</span>}
      </Text>}
    </Modal>
  );
}
