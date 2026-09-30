import { useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import AuthenticationPermissions from './AuthenticationPermissions';
import DefaultBackendAuth from './DefaultBackendAuth';
import OverlayPanel from '@components/OverlayPanel';
import Container from '@components/Container';
import IconButton from '@components/IconButton';
import IconInfo from '@assets/IconInfo';
import Modal from '@components/Modal';
import Text from '@components/Text';
import { t } from '@services/i18n/i18n';

type Props = ComponentProps<typeof AuthenticationPermissions> & { onBack: () => void };
export default function BackendAuthentication({ accounts, activeId, onBack }: Props) {
  const [infoOpen, setInfoOpen] = useState(false);
  const account = accounts.find(item => item.id === activeId) || accounts[0];
  return <OverlayPanel title={t('auth.permissions')} onBack={onBack} headerRight={
    <IconButton aria-label={t('auth.backendInfoTitle')} title={t('auth.backendInfoTitle')} onClick={() => setInfoOpen(true)}><IconInfo /></IconButton>
  }>
    <Container gap={4} className="flex-1 min-h-0 overflow-y-auto">
      {account && <DefaultBackendAuth key={account.id} accountId={account.id} variant="status" />}
      <AuthenticationPermissions accounts={accounts} activeId={activeId} showHeading={false} />
    </Container>
    {infoOpen && createPortal(<Modal title={t('auth.backendInfoTitle')} onClose={() => setInfoOpen(false)}>
      <Text>{t('auth.backendInfo')}</Text>
      <Text>{t('auth.backendAccountOnly')}</Text>
    </Modal>, document.body)}
  </OverlayPanel>;
}
