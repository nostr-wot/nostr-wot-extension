import type { AuthenticationRequest, AuthenticationScope } from '@domain/signing/authentication.ts';
import Button, { ButtonDanger, ButtonSecondary } from '@components/Button';
import Container from '@components/Container';
import Text from '@components/Text';
import { t } from '@services/i18n/i18n.ts';
export default function AuthenticationActions({authentication,requestCount=1,busy=false,onApprove,onDeny}:{authentication:AuthenticationRequest;requestCount?:number;busy?:boolean;onApprove?:(scope:AuthenticationScope)=>void;onDeny?:()=>void}) {
 return <Container gap={3}>
   <Button disabled={busy || !onApprove} onClick={()=>onApprove?.('once')}>{t(requestCount > 1 ? 'auth.onceMany' : 'auth.once', {count:requestCount})}</Button>
   {authentication.protocol==='nip98' && <Text variant="hint">{t('auth.siteHint',{method:authentication.method || '',destination:authentication.destination})}</Text>}
   <ButtonSecondary disabled={busy || !onApprove} onClick={()=>onApprove?.('site')}>{t('auth.site')}</ButtonSecondary>
   {authentication.protocol==='nip42' && <>
     <Text variant="hint">{t('auth.connectedWarning')}</Text>
     <ButtonSecondary disabled={busy || !onApprove} onClick={()=>onApprove?.('connected-sites')}>{t('auth.connectedSites')}</ButtonSecondary>
   </>}
   <ButtonDanger disabled={busy || !onDeny} onClick={onDeny}>{t('approval.deny')}</ButtonDanger>
 </Container>;
}
