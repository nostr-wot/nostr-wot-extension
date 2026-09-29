import browser from '@lib/browser.ts';
import { AsyncLock } from '@utils/asyncLock.ts';
import { siteScopes } from '@domain/site/siteScope.ts';
import type { AuthenticationRequest, AuthenticationScope, AuthenticationGrant } from '@domain/signing/authentication.ts';
import { validAuthenticationScope } from '@domain/signing/authentication.ts';

export const AUTHENTICATION_GRANTS_KEY = 'authenticationGrants';

const lock = new AsyncLock();
export async function listAuthenticationGrants(): Promise<AuthenticationGrant[]> {
  const data = await browser.storage.local.get(AUTHENTICATION_GRANTS_KEY);
  return (data[AUTHENTICATION_GRANTS_KEY] as AuthenticationGrant[] | undefined) || [];
}
export async function hasAuthenticationGrant(accountId: string, origin: string, auth: AuthenticationRequest): Promise<boolean> {
  return (await listAuthenticationGrants()).some(grant => grant.accountId === accountId
    && grant.protocol === auth.protocol && grant.destination === auth.destination && grant.method === auth.method
    && (grant.origin === origin || (auth.protocol === 'nip42' && grant.origin === '*')));
}
export async function saveAuthenticationGrant(accountId: string, origin: string, auth: AuthenticationRequest, scope: AuthenticationScope, assertCurrent: () => void): Promise<void> {
  if (!validAuthenticationScope(auth,scope)) throw new Error('Invalid authentication scope');
  if (scope === 'once') return;
  await lock.run(async()=>{
    const grants = await listAuthenticationGrants();
    assertCurrent();
    const grant: AuthenticationGrant = {accountId, origin:scope==='connected-sites'?'*':origin,protocol:auth.protocol,destination:auth.destination,
      ...(auth.method ? {method:auth.method} : {}),id:JSON.stringify([accountId,scope==='connected-sites'?'*':origin,auth.protocol,auth.destination,auth.method??''])};
    await browser.storage.local.set({[AUTHENTICATION_GRANTS_KEY]:[...grants.filter(item=>item.id!==grant.id),grant]});
  });
}
export async function revokeAuthenticationGrants(filter: {id?:string;accountId?:string;origin?:string} = {}): Promise<void> {
  await lock.run(async()=>{
    const grants = await listAuthenticationGrants();
    await browser.storage.local.set({[AUTHENTICATION_GRANTS_KEY]:grants.filter(grant => !(
      (!filter.id || grant.id === filter.id) && (!filter.accountId || grant.accountId === filter.accountId)
      && (!filter.origin || siteScopes(grant.origin).includes(filter.origin))
    ))});
  });
}
