import React from 'react';
import { t } from '@services/i18n/i18n.ts';
import IconPlus from '@assets/IconPlus.tsx';
import IconKey from '@assets/IconKey.tsx';
import IconShield from '@assets/IconShield.tsx';
import IconEye from '@assets/IconEye.tsx';
import IconLink from '@assets/IconLink.tsx';
import IconDownload from '@assets/IconDownload.tsx';
import ActionTile from '@components/ActionTile';
import IconChevronRight from '@assets/IconChevronRight.tsx';
import Heading from '@components/Heading';
import Container from '@components/Container';

interface Method {
  id: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
}

interface MethodStepProps {
  onSelect: (id: string) => void;
  onMoreOptions?: () => void;
  moreOptions?: boolean;
  hasGeneratedAccount?: boolean;
  hasAccounts?: boolean;
}

export default function MethodStep({ onSelect, onMoreOptions, moreOptions = false, hasGeneratedAccount, hasAccounts }: MethodStepProps) {
  const methods: Method[] = moreOptions ? [
    { id: 'nip46', label: t('wizard.nostrConnect'), desc: t('wizard.nostrConnectDesc'), icon: <IconLink /> },
    ...(!hasAccounts ? [{ id: 'passkeyRestore', label: t('passkey.restore'), desc: t('wizard.restorePasskeyShort'), icon: <IconDownload /> }] : []),
    { id: 'npub', label: t('wizard.watchOnly'), desc: t('wizard.watchOnlyDesc'), icon: <IconEye /> },
  ] : [
    ...(!hasAccounts ? [{ id: 'passkey', label: t('passkey.create'), desc: t('wizard.passkeyShort'), icon: <IconShield /> }] : []),
    { id: 'create', label: t(hasAccounts ? 'wizard.createAnother' : 'wizard.createWithPhrase'), desc: t(hasGeneratedAccount ? 'wizard.createSubAccountDesc' : 'wizard.phraseShort'), icon: hasGeneratedAccount ? <IconPlus /> : <IconKey /> },
    { id: 'import', label: t('wizard.importKeyBackup'), desc: t('wizard.importKeyBackupDesc'), icon: <IconDownload /> },
    ...(hasAccounts ? [
      { id: 'nip46', label: t('wizard.nostrConnect'), desc: t('wizard.nostrConnectDesc'), icon: <IconLink /> },
      { id: 'npub', label: t('wizard.watchOnly'), desc: t('wizard.watchOnlyDesc'), icon: <IconEye /> },
    ] : [{ id: 'more', label: t('wizard.moreOptions'), desc: t('wizard.moreOptionsDesc'), icon: <IconChevronRight /> }]),
  ];

  return <Container gap={5} className="flex-1 pb-6">
    <Heading>{t(moreOptions ? 'wizard.moreOptionsIntro' : hasAccounts ? 'wizard.addAccountIntro' : 'wizard.chooseSetup')}</Heading>
    <Container gap={4} className="mt-auto pt-6">
      {methods.map(method => <ActionTile key={method.id}
        icon={<div className="w-14 h-14 rounded-panel bg-brand-light text-brand flex items-center justify-center shrink-0">{method.icon}</div>}
        title={method.label} description={method.desc}
        onClick={() => method.id === 'more' ? onMoreOptions?.() : onSelect(method.id)} />)}
    </Container>
  </Container>;
}
