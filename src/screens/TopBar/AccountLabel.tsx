import { t } from '@services/i18n/i18n.ts';
import useBrowserStorage from '@hooks/useBrowserStorage';
import Container from '@components/Container';
import IconQuantum from '@assets/IconQuantum.tsx';

/**
 * Non-interactive badges are safe inside either account selector button.
 * `quantum` marks an account whose post-quantum keys are published; it explains
 * itself with a native hover title rather than an interactive tooltip, which
 * would nest a control inside the selector button.
 */
export default function AccountLabel({ name, accountId, remote = false, readOnly = false, quantum = false }: { name: string; accountId?: string; remote?: boolean; readOnly?: boolean; quantum?: boolean }) {
  const network = useBrowserStorage<boolean>(`localBridgeAccount:${accountId ?? ''}`, false) === true;
  return <Container variant="row" gap={3} className="min-w-0">
    <span className="font-semibold text-md text-heading truncate">{name}</span>
    {quantum && <span className="inline-flex text-brand shrink-0" title={t('pqc.accountBadge')}>
      <IconQuantum size={14} aria-hidden="true" /><span className="sr-only">{t('pqc.accountBadge')}</span>
    </span>}
    {(network || remote || readOnly) && <span className="text-xs font-semibold text-muted bg-brand-tint-active py-px px-2.5 rounded-xs shrink-0 leading-normal">
      {network ? t('account.network') : remote ? t('account.remote') : t('account.readOnly')}
    </span>}
  </Container>;
}
