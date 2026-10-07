import { t } from '@services/i18n/i18n.ts';
import IconPlus from '@assets/IconPlus.tsx';
import IconKey from '@assets/IconKey.tsx';
import IconShield from '@assets/IconShield.tsx';
import IconEye from '@assets/IconEye.tsx';
import IconLink from '@assets/IconLink.tsx';
import IconDownload from '@assets/IconDownload.tsx';
import ActionTile from '@components/ActionTile';
import Heading from '@components/Heading';
import Container from '@components/Container';

interface MethodStepProps {
  onSelect: (id: string) => void;
  hasGeneratedAccount?: boolean;
  hasAccounts?: boolean;
}

export default function MethodStep({ onSelect, hasGeneratedAccount, hasAccounts }: MethodStepProps) {
  const creation = [
    ...(!hasAccounts ? [{ id: 'passkey', label: t('passkey.create'), desc: t('wizard.passkeyShort'), icon: <IconShield /> }] : []),
    { id: 'create', label: t(hasAccounts ? 'wizard.createAnother' : 'wizard.createWithPhrase'), desc: t(hasGeneratedAccount ? 'wizard.createSubAccountDesc' : 'wizard.phraseShort'), icon: hasGeneratedAccount ? <IconPlus /> : <IconKey /> },
  ];
  const alternatives = [
    { id: 'import', label: t('wizard.importShort'), icon: <IconDownload /> },
    { id: 'npub', label: t('wizard.watchOnly'), icon: <IconEye /> },
    { id: 'nip46', label: t('wizard.nostrConnect'), icon: <IconLink /> },
  ];
  return <Container gap={5} className="flex-1 pb-6">
    <Heading>{t(hasAccounts ? 'wizard.addAccountIntro' : 'wizard.chooseSetup')}</Heading>
    <Container gap={4} className="mt-auto pt-6">
      {creation.map(method => <ActionTile key={method.id}
        icon={<div className="w-14 h-14 rounded-panel bg-brand-light text-brand flex items-center justify-center shrink-0">{method.icon}</div>}
        title={method.label} description={method.desc} onClick={() => onSelect(method.id)} />)}
      <div className="flex items-center gap-4 text-muted text-sm" role="separator">
        <span className="flex-1 border-t border-divider" />{t('common.or')}<span className="flex-1 border-t border-divider" />
      </div>
      <div className="grid grid-cols-3 gap-3" data-account-alternatives>
        {alternatives.map(method => <ActionTile key={method.id} compact icon={method.icon} title={method.label} onClick={() => onSelect(method.id)} />)}
      </div>
    </Container>
  </Container>;
}
