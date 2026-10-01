import browser from '@lib/browser.ts';
import { AsyncLock } from '@utils/asyncLock.ts';
import { siteScopes, hasSiteScope } from '@domain/site/siteScope.ts';
import type { AuthenticationRequest, AuthenticationScope, AuthenticationGrant } from '@domain/signing/authentication.ts';
import { connectedSiteOrigins, relayPermissionRevision } from '@domain/signing/relayPermissions';
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
  // Legacy website login always requires fresh, explicit consent.
  if (auth.protocol === 'legacy-login') return undefined;
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

/** Settings edits replace one relay's allows atomically; unrelated denials stay in force. */
export async function setRelayAuthenticationSites(accountId: string, destination: string, origins: string[], allSites: boolean, assertCurrent: () => void | Promise<void>, expectedRevision: string): Promise<void> {
  if (typeof expectedRevision !== 'string' || typeof accountId !== 'string' || !accountId || typeof destination !== 'string'
    || typeof allSites !== 'boolean' || !Array.isArray(origins) || origins.length > 1000
    || origins.some(origin => typeof origin !== 'string')) throw new Error('Invalid relay permissions');
  const selected = [...new Set(origins)];
  if (allSites && selected.length) throw new Error('Choose all sites or selected sites');
  await lock.run(async () => {
    const grants = await listAuthenticationGrants();
    const matches = (grant: AuthenticationGrant) => grant.accountId === accountId && grant.protocol === 'nip42' && grant.destination === destination;
    if (!grants.some(matches)) throw new Error('Relay permission no longer exists');
    if (relayPermissionRevision(grants, accountId, destination) !== expectedRevision) throw new Error('Relay permissions changed; reopen the editor');
    const data = await browser.storage.local.get('allowedDomains');
    const connected = (data.allowedDomains || []) as string[];
    if (selected.some(origin => !connectedSiteOrigins([origin]).includes(origin) || !hasSiteScope(connected, origin))) {
      throw new Error('Site not connected');
    }
    // Explicitly selecting a previously denied site replaces that denial. In
    // all-sites mode denials remain exceptions, never silently erased.
    const kept = grants.filter(grant => !matches(grant) || (grant.decision === 'deny' && !selected.includes(grant.origin)));
    const updated: AuthenticationGrant[] = (allSites ? ['*'] : selected).map(origin => ({
      id: JSON.stringify([accountId, origin, 'nip42', destination, '']),
      accountId, origin, protocol: 'nip42', destination, decision: 'allow',
    }));
    await assertCurrent();
    await browser.storage.local.set({ [AUTHENTICATION_GRANTS_KEY]: [...kept, ...updated] });
  });
}
