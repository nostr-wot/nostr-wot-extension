import { lazy, Suspense, useState } from 'react';
import { useAccount } from '@context/AccountContext';
const ConnectionTemplateDialog = lazy(() => import('@components/PermissionTemplates/ConnectionTemplateDialog'));
/** Both browser connection entrypoints share one consent flow. */
export default function useConnectionTemplate(domain: string | null, onConnected: () => void) {
  const { active } = useAccount();
  const [target, setTarget] = useState<{ domain: string; accountId: string } | null>(null);
  return {
    open: () => { if (domain && active) setTarget({ domain, accountId: active.id }); },
    dialog: target && target.domain === domain ? <Suspense fallback={null}><ConnectionTemplateDialog key={`${target.domain}:${target.accountId}`} {...target} onClose={() => setTarget(null)} onConnected={onConnected} /></Suspense> : null,
  };
}
