import type { AuthenticationRequest, AuthenticationScope } from '@domain/signing/authentication.ts';
import Button, { ButtonDanger } from '@components/Button';
import Container from '@components/Container';
import ApprovalActions from '@components/ApprovalActions';
import { t } from '@services/i18n/i18n.ts';

export default function AuthenticationActions({authentication,requestCount=1,busy=false,onApprove,onDeny,onAlwaysDeny}:{
  authentication:AuthenticationRequest;requestCount?:number;busy?:boolean;
  onApprove?:(scope:AuthenticationScope)=>void;onDeny?:()=>void;onAlwaysDeny?:()=>void;
}) {
  if (authentication.protocol === 'legacy-login') return <Container variant="row" gap={4} className="justify-end flex-wrap">
    <ButtonDanger small disabled={busy || !onApprove} onClick={() => onApprove?.('once')}>{t('auth.legacyApprove')}</ButtonDanger>
    <Button small variant="secondary" disabled={busy || !onDeny} onClick={onDeny}>{t('auth.reject')}</Button>
  </Container>;
  const choices = [{
    value:'site',label:'',allowLabel:t('auth.approveAlways'),denyLabel:t('auth.rejectAlways'),
    onAlwaysAllow:onApprove ? () => onApprove('site') : undefined,onAlwaysDeny,
  }];
  if (authentication.protocol === 'nip42') choices.push({
    value:'connected-sites',label:'',allowLabel:t('auth.approveAllSites'),denyLabel:'',
    onAlwaysAllow:onApprove ? () => onApprove('connected-sites') : undefined,onAlwaysDeny:undefined,
  });
  return <ApprovalActions requestCount={requestCount} rejectCount={1} busy={busy} placement="above"
    approveLabel={requestCount === 1 ? t('approval.approve') : undefined} rejectLabel={t('auth.reject')}
    onApprove={onApprove ? () => onApprove('once') : undefined} onReject={onDeny} choices={choices}/>;
}
