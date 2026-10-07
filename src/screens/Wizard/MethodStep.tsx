import React from 'react';
import { t } from '@services/i18n/i18n.ts';
import IconPlus from '@assets/IconPlus.tsx';
import IconKey from '@assets/IconKey.tsx';
import IconShield from '@assets/IconShield.tsx';
import IconEye from '@assets/IconEye.tsx';
import IconLink from '@assets/IconLink.tsx';
import IconDownload from '@assets/IconDownload.tsx';
import ActionTile from '@components/ActionTile';
import LinkButton from '@components/LinkButton';
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
    { id: 'create', label: t(hasGeneratedAccount ? 'wizard.createSubAccount' : 'wizard.createWithPhrase'), desc: t(hasGeneratedAccount ? 'wizard.createSubAccountDesc' : 'wizard.phraseShort'), icon: hasGeneratedAccount ? <IconPlus /> : <IconKey /> },
  ];

  return <Container gap={5} className="flex-1 pb-6">
    {!moreOptions && <Heading>{t(hasAccounts ? 'wizard.addAccount' : 'wizard.createAccountTitle')}</Heading>}
    <Container gap={4}>
      {methods.map(method => <ActionTile key={method.id} icon={method.icon} title={method.label} description={method.desc} onClick={() => onSelect(method.id)} />)}
    </Container>
    {!moreOptions && <Container gap={2}>
      <LinkButton tone="brand" className="min-h-11 text-sm" onClick={() => onSelect('import')}>{t('wizard.importExisting')}</LinkButton>
      <LinkButton tone="brand" className="min-h-11 text-sm" onClick={onMoreOptions}>{t('wizard.moreOptions')}</LinkButton>
    </Container>}
  </Container>;
}
