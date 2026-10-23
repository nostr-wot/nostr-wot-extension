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
  otherMethods?: boolean;
}

export default function MethodStep({ onSelect, hasGeneratedAccount, hasAccounts, otherMethods = false }: MethodStepProps) {
  const creation = [
    ...(!hasAccounts ? [{ id: 'passkey', label: t('passkey.create'), desc: t('wizard.passkeyShort'), icon: <IconShield /> }] : []),
    { id: 'create', label: t(hasAccounts ? 'wizard.createAnother' : 'wizard.createWithPhrase'), desc: t(hasGeneratedAccount ? 'wizard.createSubAccountDesc' : 'wizard.phraseShort'), icon: hasGeneratedAccount ? <IconPlus /> : <IconKey /> },
  ];
  const alternatives = [
    { id: 'import', label: t('recoveryFlow.title'), desc: t('wizard.importKeyBackupDesc'), icon: <IconDownload /> },
    { id: 'npub', label: t('wizard.watchOnly'), desc: t('wizard.watchOnlyDesc'), icon: <IconEye /> },
    { id: 'nip46', label: t('wizard.nostrConnect'), desc: t('wizard.nostrConnectDesc'), icon: <IconLink /> },
  ];
  const divider = <div className="flex items-center gap-4 text-muted text-sm" role="separator"><span className="flex-1 border-t border-divider" />{t('common.or')}<span className="flex-1 border-t border-divider" /></div>;
  return <Container gap={5} className="flex-1 pb-6">
    <Heading>{t(otherMethods ? 'wizard.otherMethodsIntro' : hasAccounts ? 'wizard.addAccountIntro' : 'wizard.chooseSetup')}</Heading>
    <Container gap={4} className="mt-auto pt-6">
      {(otherMethods ? alternatives : creation).map(method => <ActionTile key={method.id} raised
        icon={<div className="w-14 h-14 rounded-panel bg-brand-light text-brand flex items-center justify-center shrink-0">{method.icon}</div>}
        title={method.label} description={method.desc} onClick={() => onSelect(method.id)} />)}
      {!otherMethods && <>{divider}
      <ActionTile raised icon={<div className="w-14 h-14 rounded-panel bg-brand-light text-brand flex items-center justify-center shrink-0"><IconDownload /></div>} title={t('wizard.otherMethods')} description={t('wizard.otherMethodsDesc')} onClick={() => onSelect('moreOptions')} /></>}
    </Container>
  </Container>;
}
