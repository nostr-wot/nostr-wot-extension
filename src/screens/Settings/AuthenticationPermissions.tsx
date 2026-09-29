import type { SafeAccount } from '@domain/accounts/types.ts';
import type { AuthenticationGrant } from '@domain/signing/authentication.ts';
import { useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import Container from '@components/Container';
import Text from '@components/Text';
import FieldDisplay from '@components/FieldDisplay';
import FormError from '@components/FormError';
import { SectionLabel } from '@components/SectionLabel';
import Button, { ButtonDanger } from '@components/Button';
import Dropdown from '@components/Dropdown';
type AccountSummary = Pick<SafeAccount, 'id' | 'pubkey'> & Partial<Pick<SafeAccount, 'name'>>;
export default function AuthenticationPermissions({accounts,activeId}:{accounts:AccountSummary[];activeId?:string|null}) {
 const [selected,setSelected]=useState(activeId || accounts[0]?.id || '');
 const account=accounts.find(item=>item.id===selected) || accounts.find(item=>item.id===activeId) || accounts[0];
 return <Container gap={3}>
  <SectionLabel>{t('auth.permissions')}</SectionLabel>
  <Text variant="hint">{t('auth.accountOnly')}</Text>
  {accounts.length>1 && <Dropdown value={account?.id || ''} options={accounts.map(item=>({value:item.id,label:item.name || item.pubkey}))} onChange={setSelected} />}
  {account && <AccountGrants key={account.id} account={account}/>}
 </Container>;
}
function AccountGrants({account}:{account:AccountSummary}) {
 const [busy,setBusy]=useState(false); const [actionError,setActionError]=useState('');
 const {data,loading,error,refresh}=useAsyncResource<{grants:AuthenticationGrant[]}>({grants:[]},{load:async(patch,current)=>{
  const grants=await rpc<AuthenticationGrant[]>('signer_getAuthenticationGrants');
  if(current()) patch({grants:grants.filter(grant=>grant.accountId===account.id)});
 }});
 const revoke=async(id:string)=>{
  setBusy(true);setActionError('');
  try {await rpc('signer_revokeAuthenticationGrant',{id});await refresh();}
  catch {setActionError(t('approval.actionFailed'));}
  finally {setBusy(false);}
 };
 return <Container gap={3}>
  <FieldDisplay label={t('auth.account')} value={account.pubkey} mono/>
  {loading && <Text variant="hint">{t('common.loading')}</Text>}
  <FormError>{error || actionError}</FormError>
  {error && <Button small disabled={loading} onClick={()=>void refresh()}>{t('common.retry')}</Button>}
  {!loading && !error && !data.grants.length && <Text variant="hint">{t('auth.noGrants')}</Text>}
  {data.grants.map(grant=><Container variant="box" key={grant.id} gap={3} className="break-all">
   <Text>{t(grant.decision === 'deny' ? 'auth.rejectAlways' : 'auth.approveAlways')}</Text>
   <FieldDisplay label={t('auth.destination')} value={`${grant.method ? `${grant.method} ` : ''}${grant.destination}`} mono/>
   <FieldDisplay label={t('auth.requester')} value={grant.origin==='*' ? t('auth.allConnected') : grant.origin}/>
   {grant.origin==='*' && <Text variant="hint">{t('auth.connectedWarning')}</Text>}
   <ButtonDanger small disabled={busy || loading} onClick={()=>void revoke(grant.id)}>{t('auth.revoke')}</ButtonDanger>
  </Container>)}
 </Container>;
}
