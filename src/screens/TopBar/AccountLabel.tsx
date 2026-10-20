import { t } from '@services/i18n/i18n.ts';
import useBrowserStorage from '@hooks/useBrowserStorage';
import Container from '@components/Container';

/** Non-interactive badges are safe inside either account selector button. */
export default function AccountLabel({ name, accountId, remote = false, readOnly = false }: { name: string; accountId?: string; remote?: boolean; readOnly?: boolean }) {
  const network = useBrowserStorage<boolean>(`localBridgeAccount:${accountId ?? ''}`, false) === true;
  return <Container variant="row" gap={3} className="min-w-0">
    <span className="font-semibold text-md text-heading truncate">{name}</span>
    {(network || remote || readOnly) && <span className="text-xs font-semibold text-muted bg-brand-tint-active py-px px-2.5 rounded-xs shrink-0 leading-normal">
      {network ? t('account.network') : remote ? t('account.remote') : t('account.readOnly')}
    </span>}
  </Container>;
}
