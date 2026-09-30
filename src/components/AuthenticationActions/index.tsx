import type { AuthenticationRequest, AuthenticationScope } from '@domain/signing/authentication.ts';
import ApprovalActions from '@components/ApprovalActions';
import { t } from '@services/i18n/i18n.ts';

export default function AuthenticationActions({authentication,requestCount=1,busy=false,onApprove,onDeny,onAlwaysDeny}:{
  authentication:AuthenticationRequest;requestCount?:number;busy?:boolean;
  onApprove?:(scope:AuthenticationScope)=>void;onDeny?:()=>void;onAlwaysDeny?:()=>void;
}) {
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
    approveDescription={authentication.protocol === 'nip98' ? t('auth.siteHint', {method:authentication.method || '',destination:authentication.url}) : undefined}
    onApprove={onApprove ? () => onApprove('once') : undefined} onReject={onDeny} choices={choices}/>;
}
