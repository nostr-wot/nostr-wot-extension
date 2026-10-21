import type { AuthenticationRequest, AuthenticationScope } from '@domain/signing/authentication.ts';
import Button, { ButtonDanger } from '@components/Button';
import Container from '@components/Container';
import ApprovalActions from '@components/ApprovalActions';
import { t } from '@services/i18n/i18n.ts';

const RELAY_SCOPE_LABELS = {
  'site-all-relays':'auth.relayApproveSiteAllRelays',
  'connected-sites':'auth.relayApproveAllSites',
  'connected-sites-all-relays':'auth.relayApproveEverywhere',
} as const;

export default function AuthenticationActions({authentication,requestCount=1,busy=false,onApprove,onDeny,onAlwaysDeny}:{
  authentication:AuthenticationRequest;requestCount?:number;busy?:boolean;
  onApprove?:(scope:AuthenticationScope)=>void;onDeny?:()=>void;onAlwaysDeny?:()=>void;
}) {
  if (authentication.protocol === 'legacy-login') return <Container variant="row" gap={4} className="justify-end flex-wrap">
    <ButtonDanger small disabled={busy || !onApprove} onClick={() => onApprove?.('once')}>{t('auth.legacyApprove')}</ButtonDanger>
    <Button small variant="secondary" disabled={busy || !onDeny} onClick={onDeny}>{t('auth.reject')}</Button>
  </Container>;
  const relay = authentication.protocol === 'nip42';
  const remembered = (scope:AuthenticationScope) => onApprove ? () => onApprove(scope) : undefined;
  // Relay choices run from narrowest to broadest; denial stays per relay and site.
  const choices = [{
    value:'site',label:'',allowLabel:t(relay ? 'auth.relayApproveSite' : 'auth.approveAlways'),denyLabel:t('auth.rejectAlways'),
    onAlwaysAllow:remembered('site'),onAlwaysDeny,
  }, ...relay ? (['site-all-relays','connected-sites','connected-sites-all-relays'] as const).map(scope => ({
    value:scope,label:'',allowLabel:t(RELAY_SCOPE_LABELS[scope]),denyLabel:'',onAlwaysAllow:remembered(scope),onAlwaysDeny:undefined,
  })) : []];
  return <ApprovalActions requestCount={requestCount} rejectCount={1} busy={busy} placement="above"
    approveLabel={requestCount === 1 ? t('approval.approve') : undefined} rejectLabel={t('auth.reject')}
    onApprove={onApprove ? () => onApprove('once') : undefined} onReject={onDeny} choices={choices}/>;
}
