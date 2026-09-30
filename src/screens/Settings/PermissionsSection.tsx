import { Fragment, forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { t } from '@services/i18n/i18n';
import { useAccount } from '@context/AccountContext';
import RelayAuthentication, { type RelayAuthenticationHandle } from './RelayAuthentication';
import BackendAuthentication from './BackendAuthentication';
import DefaultBackendAuth from './DefaultBackendAuth';
import GlobalRules from './GlobalRules';
import RulesScreen from './RulesScreen';
import Card from '@components/Card';
import Container from '@components/Container';
import ListRow from '@components/ListRow';
import IconGlobe from '@assets/IconGlobe';
import IconTuner from '@assets/IconTuner';
import IconKey from '@assets/IconKey';
import IconCloud from '@assets/IconCloud';
import IconChevronRight from '@assets/IconChevronRight';

export interface PermissionsSectionHandle { goBack: () => boolean }
export default forwardRef<PermissionsSectionHandle>(function PermissionsSection(_props, ref) {
  const { accounts, activeId } = useAccount();
  const account = accounts?.find(account => account.id === activeId) || accounts?.[0];
  const [screen, setScreen] = useState<'rules' | 'global' | 'backend' | 'relay' | null>(null);
  const relayRef = useRef<RelayAuthenticationHandle>(null);
  const back = () => setScreen(null);
  useImperativeHandle(ref, () => ({ goBack: () => {
    if (!screen) return false;
    if (screen === 'relay' && relayRef.current?.goBack()) return true;
    back(); return true;
  } }));
  if (screen === 'rules') return <RulesScreen key={activeId} onBack={back} />;
  if (screen === 'global') return <GlobalRules onBack={back} />;
  if (screen === 'backend' && account) return <BackendAuthentication key={account.id} accounts={accounts || []} activeId={activeId} onBack={back} />;
  if (screen === 'relay' && account) return <RelayAuthentication key={account.id} ref={relayRef} accountId={account.id} onBack={back} />;
  const rows = [
    { screen:'global' as const, title:'perms.globalRules', hint:'perms.globalRulesHint', icon:IconGlobe },
    { screen:'rules' as const, title:'perms.rules', hint:'perms.rulesHint', icon:IconTuner },
    { screen:'backend' as const, title:'auth.permissions', hint:'auth.manageBackends', icon:IconKey },
    { screen:'relay' as const, title:'auth.relayPermissions', hint:'auth.manageRelays', icon:IconCloud },
  ];
  return <Container gap={4} className="flex-1 min-h-0 overflow-y-auto py-2">
    <Card className="p-0 overflow-hidden mb-0 shrink-0 [&>*+*]:[border-top:1px_solid_var(--brand-tint-active)]">
      {rows.map(row => <Fragment key={row.screen}>
        {row.screen === 'backend' && account && <DefaultBackendAuth key={account.id} accountId={account.id} />}
        <ListRow key={row.screen} leading={<row.icon size={15} aria-hidden="true" />} leadingChip={false}
        className="px-7 py-5.5 gap-4" title={t(row.title)} subtitle={t(row.hint)}
        trailing={<span className="w-20 flex justify-center"><IconChevronRight size={16} /></span>}
        onClick={() => setScreen(row.screen)} /></Fragment>)}
    </Card>
  </Container>;
});
