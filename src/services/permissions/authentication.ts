import browser from '@lib/browser.ts';
import { AsyncLock } from '@utils/asyncLock.ts';
import { siteScopes } from '@domain/site/siteScope.ts';
import type { AuthenticationRequest, AuthenticationScope, AuthenticationGrant } from '@domain/signing/authentication.ts';
import { findKnownAuthenticationBackend, validAuthenticationScope } from '@domain/signing/authentication.ts';

export const AUTHENTICATION_GRANTS_KEY = 'authenticationGrants';

export const DEFAULT_BACKEND_AUTH_KEY = 'defaultBackendAuthAccounts';
const lock = new AsyncLock();
export async function getDefaultBackendAuth(accountId: string): Promise<boolean> {
  const data = await browser.storage.local.get(DEFAULT_BACKEND_AUTH_KEY);
  return (data[DEFAULT_BACKEND_AUTH_KEY] as Record<string, unknown> | undefined)?.[accountId] === true;
}
export async function setDefaultBackendAuth(accountId: string, enabled: boolean): Promise<void> {
  if (typeof accountId !== 'string' || !accountId || typeof enabled !== 'boolean') throw new Error('Invalid backend authentication setting');
  await lock.run(async () => {
    const data = await browser.storage.local.get(DEFAULT_BACKEND_AUTH_KEY);
    await browser.storage.local.set({[DEFAULT_BACKEND_AUTH_KEY]: {...(data[DEFAULT_BACKEND_AUTH_KEY] as Record<string, boolean> || {}), [accountId]: enabled}});
  });
}
/** Only exact HTTPS origins and explicitly NIP-98 registry pairs qualify. */
function matchesDefaultBackend(origin: string, auth: AuthenticationRequest): boolean {
  if (auth.protocol !== 'nip98' || !origin.startsWith('https://') || !auth.destination.startsWith('https://')) return false;
  return origin === auth.destination || !!findKnownAuthenticationBackend(origin, auth);
}
export async function listAuthenticationGrants(): Promise<AuthenticationGrant[]> {
  const data = await browser.storage.local.get(AUTHENTICATION_GRANTS_KEY);
  return (data[AUTHENTICATION_GRANTS_KEY] as AuthenticationGrant[] | undefined) || [];
}
/** Legacy HTTP denies remain broad; legacy allows never acquire endpoint authority. */
function matchesGrant(grant: AuthenticationGrant, accountId: string, origin: string, auth: AuthenticationRequest): boolean {
  if (grant.accountId !== accountId || grant.protocol !== auth.protocol
    || grant.destination !== auth.destination || grant.method !== auth.method
    || !(grant.origin === origin || (auth.protocol === 'nip42' && grant.origin === '*'))) return false;
  if (auth.protocol === 'nip42') return true;
  if (grant.version === 2 && typeof grant.resource === 'string') return grant.resource === auth.url;
  return grant.decision === 'deny';
}
export async function getAuthenticationDecision(accountId: string, origin: string, auth: AuthenticationRequest): Promise<'allow' | 'deny' | undefined> {
  const matching = (await listAuthenticationGrants()).filter(grant => matchesGrant(grant,accountId,origin,auth));
  // A site-specific rejection takes precedence over a shared relay allowance.
  if (matching.some(grant => grant.decision === 'deny')) return 'deny';
  if (matching.some(grant => grant.decision === undefined || grant.decision === 'allow')) return 'allow';
  if (matchesDefaultBackend(origin, auth) && await getDefaultBackendAuth(accountId)) return 'allow';
}
export async function hasAuthenticationGrant(accountId: string, origin: string, auth: AuthenticationRequest): Promise<boolean> {
  return await getAuthenticationDecision(accountId, origin, auth) === 'allow';
}
export async function saveAuthenticationGrant(accountId: string, origin: string, auth: AuthenticationRequest, scope: AuthenticationScope, assertCurrent: () => void, decision: 'allow' | 'deny' = 'allow'): Promise<void> {
  if (!validAuthenticationScope(auth,scope)) throw new Error('Invalid authentication scope');
  if (decision === 'deny' && scope !== 'site') throw new Error('Invalid authentication denial scope');
  await lock.run(async()=>{
    const grants = await listAuthenticationGrants();
    assertCurrent();
    // A queued approval must not erase a rejection saved while it waited for
    // this lock. Revocation in settings is the explicit way to remove a deny.
    if (decision === 'allow' && grants.some(grant => grant.decision === 'deny'
      && matchesGrant(grant,accountId,origin,auth))) {
      throw new Error('Authentication permission denied');
    }
    if (scope === 'once') return;
    const grant: AuthenticationGrant = {decision,accountId, origin:scope==='connected-sites'?'*':origin,protocol:auth.protocol,destination:auth.destination,
      ...(auth.protocol === 'nip98' ? {version:2 as const,resource:auth.url} : {}),
      ...(auth.method ? {method:auth.method} : {}),id:JSON.stringify([accountId,scope==='connected-sites'?'*':origin,auth.protocol,auth.protocol==='nip98'?auth.url:auth.destination,auth.method??''])};
    await browser.storage.local.set({[AUTHENTICATION_GRANTS_KEY]:[...grants.filter(item=>item.id!==grant.id),grant]});
  });
}
export async function revokeAuthenticationGrants(filter: {id?:string;accountId?:string;origin?:string} = {}): Promise<void> {
  await lock.run(async()=>{
    const grants = await listAuthenticationGrants();
    if (!filter.id && !filter.origin) {
      const data = await browser.storage.local.get(DEFAULT_BACKEND_AUTH_KEY);
      const defaults = {...(data[DEFAULT_BACKEND_AUTH_KEY] as Record<string, boolean> || {})};
      if (filter.accountId) delete defaults[filter.accountId];
      await browser.storage.local.set({[DEFAULT_BACKEND_AUTH_KEY]: filter.accountId ? defaults : {}});
    }
    await browser.storage.local.set({[AUTHENTICATION_GRANTS_KEY]:grants.filter(grant => !(
      (!filter.id || grant.id === filter.id) && (!filter.accountId || grant.accountId === filter.accountId)
      && (!filter.origin || siteScopes(grant.origin).includes(filter.origin))
    ))});
  });
}
