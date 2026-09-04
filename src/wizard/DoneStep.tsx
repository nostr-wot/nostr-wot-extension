import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import Card from '@components/Card/Card';

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
      <h2 className="text-3xl font-bold text-heading mb-3">{t('wizard.yourAllSet')}</h2>
      <p className="text-md text-secondary leading-normal mb-8">
        {t('wizard.identityReady')}
      </p>

      {account && (
        <Card variant="flat">
          {account.name && (
            <div className="flex justify-between py-3 border-b border-card last:border-b-0">
              <label className="text-sm font-semibold text-muted">{t('wizard.nameLabel')}</label>
              <span className="text-sm font-medium text-heading">{account.name}</span>
            </div>
          )}
          <div className="flex justify-between py-3 border-b border-card last:border-b-0">
            <label className="text-sm font-semibold text-muted">{t('wizard.typeLabel')}</label>
            <span className="text-sm font-medium text-heading">{t(`wizard.type.${account.type}`)}</span>
          </div>
          <div className="flex justify-between py-3 border-b border-card last:border-b-0">
            <label className="text-sm font-semibold text-muted">{t('wizard.publicKeyLabel')}</label>
            <span className="text-sm font-medium text-heading">{account.pubkey?.slice(0, 12)}...{account.pubkey?.slice(-12)}</span>
          </div>
        </Card>
      )}

      <div className="flex gap-4 mt-auto py-8 sticky bottom-0 z-[1] [background:var(--bg-page)]">
        <Button className="flex-1" onClick={onDone}>{t('wizard.getStarted')}</Button>
      </div>
    </div>
  );
}
