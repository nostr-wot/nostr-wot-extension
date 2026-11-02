import { lazy, Suspense, useRef, useState } from 'react';
import { useAccount } from '@context/AccountContext';
import { rpc } from '@services/rpc';
import Modal from '@components/Modal';
import FormError from '@components/FormError';
import { t } from '@services/i18n/i18n';
import { createPortal } from 'react-dom';
const ConnectionTemplateDialog = lazy(() => import('@components/PermissionTemplates/ConnectionTemplateDialog'));
/** Both browser connection entrypoints share one consent flow. */
export default function useConnectionTemplate(domain: string | null, onConnected: () => void) {
  const { active } = useAccount();
  const [target, setTarget] = useState<{ domain: string; accountId: string } | null>(null);
  const busy = useRef(false);
  const [error, setError] = useState('');
  const open = async () => {
    if (!domain || !active || busy.current) return;
    if (active.type !== 'nip46') { setTarget({ domain, accountId: active.id }); return; }
    busy.current = true; setError('');
    try { await rpc('templates_connect', { domain, accountId: active.id, rules: {} }); onConnected(); }
    catch (e) { setError((e as Error).message); }
    finally { busy.current = false; }
  };
  return {
    open: () => { void open(); },
    dialog: error ? createPortal(<Modal title={t('common.error')} onClose={() => setError('')}><FormError>{error}</FormError></Modal>, document.body) : target && target.domain === domain ? <Suspense fallback={null}><ConnectionTemplateDialog key={`${target.domain}:${target.accountId}`} {...target} onClose={() => setTarget(null)} onConnected={onConnected} /></Suspense> : null,
  };
}
