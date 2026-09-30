import { Fragment, forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { t } from '@services/i18n/i18n';
import { useAccount } from '@context/AccountContext';
import RelayAuthentication, { type RelayAuthenticationHandle } from './RelayAuthentication';
import BackendAuthentication from './BackendAuthentication';
import DefaultBackendAuth from './DefaultBackendAuth';
import RulesScreen, { type RulesScreenHandle } from './RulesScreen';
import Card from '@components/Card';
import Container from '@components/Container';
import ListRow from '@components/ListRow';
import IconShield from '@assets/IconShield';
import IconChevronRight from '@assets/IconChevronRight';

export interface PermissionsSectionHandle { goBack: () => boolean }
interface Props { initialDomain?: string | null; onDetailChange?: (domain: string | null) => void }
export default forwardRef<PermissionsSectionHandle, Props>(function PermissionsSection({ initialDomain, onDetailChange }, ref) {
  const { accounts, activeId } = useAccount();
  const account = accounts?.find(account => account.id === activeId) || accounts?.[0];
  const [screen, setScreen] = useState<'rules' | 'global' | 'backend' | 'relay' | null>(initialDomain ? 'rules' : null);
  const relayRef = useRef<RelayAuthenticationHandle>(null);
  const rulesRef = useRef<RulesScreenHandle>(null);
  const back = () => { setScreen(null); onDetailChange?.(null); };
  useImperativeHandle(ref, () => ({ goBack: () => {
    if (!screen) return false;
    if (screen === 'relay' && relayRef.current?.goBack()) return true;
    if ((screen === 'rules' || screen === 'global') && rulesRef.current?.goBack()) return true;
    back(); return true;
  } }));
  if (screen === 'rules' || screen === 'global') return <RulesScreen key={`${screen}:${activeId}`} ref={rulesRef}
    globalMode={screen === 'global'} initialDomain={initialDomain} onDetailChange={onDetailChange} onBack={back} />;
  if (screen === 'backend' && account) return <BackendAuthentication key={account.id} accounts={accounts || []} activeId={activeId} onBack={back} />;
  if (screen === 'relay' && account) return <RelayAuthentication key={account.id} ref={relayRef} accountId={account.id} onBack={back} />;
  const rows = [
    { screen:'rules' as const, title:'perms.rules', hint:'perms.rulesHint' },
    { screen:'global' as const, title:'perms.globalRules', hint:'perms.globalRulesHint' },
    { screen:'backend' as const, title:'auth.permissions', hint:'auth.manageBackends' },
    { screen:'relay' as const, title:'auth.relayPermissions', hint:'auth.manageRelays' },
  ];
  return <Container gap={4} className="flex-1 min-h-0 overflow-y-auto py-2">
    <Card className="p-0 overflow-hidden mb-0 shrink-0 [&>*+*]:[border-top:1px_solid_var(--brand-tint-active)]">
      {rows.map(row => <Fragment key={row.screen}>
        {row.screen === 'backend' && account && <DefaultBackendAuth key={account.id} accountId={account.id} />}
        <ListRow key={row.screen} leading={<IconShield size={15} />} leadingChip={false}
        className="px-7 py-5.5 gap-4" title={t(row.title)} subtitle={t(row.hint)}
        trailing={<span className="w-20 flex justify-center"><IconChevronRight size={16} /></span>}
        onClick={() => setScreen(row.screen)} /></Fragment>)}
    </Card>
  </Container>;
});
