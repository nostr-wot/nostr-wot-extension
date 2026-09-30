import { useState } from 'react';
import { createPortal } from 'react-dom';
import Container from '@components/Container';
import StatusNotice from '@components/StatusNotice';
import { DEFAULT_BACKEND_AUTH_RULES_URL } from '@constants/permissions';
import Text from '@components/Text';
import Toggle from '@components/Toggle';
import Modal from '@components/Modal';
import IconButton from '@components/IconButton';
import IconInfo from '@assets/IconInfo';
import IconShield from '@assets/IconShield';
import FormError from '@components/FormError';
import Button from '@components/Button';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import useStorageWatch from '@hooks/useStorageWatch.ts';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';

export default function DefaultBackendAuth({ accountId, variant = 'toggle' }: { accountId: string; variant?: 'toggle' | 'status' }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const { data, loading, error, refresh } = useAsyncResource({ enabled: false }, {
    deps: [accountId],
    load: async (patch, current) => {
      const enabled = await rpc<boolean>('signer_getDefaultBackendAuth', { accountId });
      if (current()) patch({ enabled: enabled === true });
    },
  });
  useStorageWatch([{ area: 'local', keys: ['defaultBackendAuthAccounts'] }], refresh);
  const setDefault = async (enabled: boolean) => {
    setBusy(true);
    setActionError('');
    try {
      await rpc('signer_setDefaultBackendAuth', { accountId, enabled });
      await refresh();
    } catch {
      setActionError(t('approval.actionFailed'));
    } finally {
      setBusy(false);
    }
  };
  const rulesLink = <a className="inline-flex items-center gap-2.5 text-xs text-brand cursor-pointer hover:text-brand-hover"
    href={DEFAULT_BACKEND_AUTH_RULES_URL} target="_blank" rel="noreferrer noopener">{t('auth.defaultBackendRulesLink')}</a>;
  if (variant === 'status') {
    if (error) return <Container gap={3}><FormError>{error}</FormError><Button small disabled={loading} onClick={() => void refresh()}>{t('common.retry')}</Button></Container>;
    if (loading || !data.enabled) return null;
    return <StatusNotice tone="ok" variant="callout" icon={<IconShield size={18} />} label={t('auth.defaultBackendEnabled')}>
      <Container gap={3}><Text variant="secondary">{t('auth.defaultBackendActiveHint')}</Text>{rulesLink}</Container>
    </StatusNotice>;
  }
  return <div>
    <Container variant="row" gap={3} className="justify-between py-5.5 px-7">
      <Container variant="row" gap={4} className="min-w-0 flex-1">
        <IconShield size={15} className="text-brand shrink-0" />
        <div>
          <span className="text-md font-medium text-body">{t('auth.defaultBackend')}</span>
          <Text variant="muted" as="div" className="mt-px">{t('auth.backendAccountOnly')}</Text>
        </div>
      </Container>
      <IconButton aria-label={t('auth.defaultBackendInfo')} onClick={() => setInfoOpen(true)}><IconInfo /></IconButton>
      <Toggle aria-label={t('auth.defaultBackend')} checked={data.enabled} disabled={busy || loading || !!error} onChange={enabled => void setDefault(enabled)} />
    </Container>
    {(error || actionError) && <Container gap={3} className="px-7 pb-5">
      <FormError>{error || actionError}</FormError>
      {error && <Button small disabled={loading} onClick={() => void refresh()}>{t('common.retry')}</Button>}
    </Container>}
    {infoOpen && createPortal(<Modal title={t('auth.defaultBackend')} onClose={() => setInfoOpen(false)}>
      <Text>{t('auth.defaultBackendExplanation')}</Text>
      <Text>{t('auth.defaultBackendLimits')}</Text>
      {rulesLink}
    </Modal>, document.body)}
  </div>;
}
