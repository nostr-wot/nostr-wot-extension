import type { SafeAccount } from '@domain/accounts/types.ts';
import type { AuthenticationGrant } from '@domain/signing/authentication.ts';
import { useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import useStorageWatch from '@hooks/useStorageWatch.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import Container from '@components/Container';
import Text from '@components/Text';
import FormError from '@components/FormError';
import { SectionLabel } from '@components/SectionLabel';
import Button, { ButtonDanger } from '@components/Button';
type AccountSummary = Pick<SafeAccount, 'id' | 'pubkey'> & Partial<Pick<SafeAccount, 'name'>>;
export default function AuthenticationPermissions({accounts,activeId,showHeading=true}:{accounts:AccountSummary[];activeId?:string|null;showHeading?:boolean}) {
 const account=accounts.find(item=>item.id===activeId) || accounts[0];
 return <Container gap={3} className="shrink-0">
  {showHeading && <SectionLabel>{t('auth.permissions')}</SectionLabel>}
  <Text variant="hint">{t('auth.backendAccountOnly')}</Text>
  {account && <AccountGrants key={account.id} account={account}/>}
 </Container>;
}
function AccountGrants({account}:{account:AccountSummary}) {
 const [busy,setBusy]=useState(false); const [actionError,setActionError]=useState('');
 const {data,loading,error,refresh}=useAsyncResource<{grants:AuthenticationGrant[]}>({grants:[]},{load:async(patch,current)=>{
  const grants=await rpc<AuthenticationGrant[]>('signer_getAuthenticationGrants');
  if(current()) patch({grants:grants.filter(grant=>grant.accountId===account.id && grant.protocol==='nip98')});
 }});
 useStorageWatch([{area:'local',keys:['authenticationGrants']}],refresh);
 const revoke=async(id:string)=>{
  setBusy(true);setActionError('');
  try {await rpc('signer_revokeAuthenticationGrant',{id});await refresh();}
  catch {setActionError(t('approval.actionFailed'));}
  finally {setBusy(false);}
 };
 return <Container gap={3} className="shrink-0">
  {loading && <Text variant="hint">{t('common.loading')}</Text>}
  <FormError>{error || actionError}</FormError>
  {error && <Button small disabled={loading} onClick={()=>void refresh()}>{t('common.retry')}</Button>}
  {!loading && !error && !data.grants.length && <Text variant="hint">{t('auth.backendNoGrants')}</Text>}
  {!!data.grants.length && <div className="overflow-x-auto">
   <table className="w-full text-sm border-collapse text-left">
    <thead><tr className="text-secondary">
     <th scope="col" className="py-3">{t('auth.destination')}</th>
     <th scope="col" className="p-3">{t('auth.requester')}</th>
     <th scope="col" className="p-3">{t('auth.decision')}</th>
     <th scope="col" className="py-3">{t('wot.databaseActions')}</th>
    </tr></thead>
    <tbody>{data.grants.map(grant=><tr key={grant.id} className="border-t border-card-border">
     <td className="py-3 align-top font-mono break-all">{grant.method ? `${grant.method} ` : ''}{grant.resource ?? grant.destination}</td>
     <td className="p-3 align-top break-all">{grant.origin}</td>
     <td className="p-3 align-top">{t(grant.decision==='deny' ? 'auth.rejectAlways' : 'auth.approveAlways')}</td>
     <td className="py-3 align-top"><ButtonDanger small disabled={busy || loading} aria-label={`${t('auth.revoke')}: ${grant.destination}`} onClick={()=>void revoke(grant.id)}>{t('auth.revoke')}</ButtonDanger></td>
    </tr>)}</tbody>
   </table>
  </div>}

 </Container>;
}
