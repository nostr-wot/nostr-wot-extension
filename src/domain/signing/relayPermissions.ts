import type { AuthenticationGrant } from './authentication';

export interface RelayPermissionGroup {
  destination: string;
  revision: string;
  allSites: boolean;
  allowedOrigins: string[];
  deniedOrigins: string[];
}

export function groupRelayPermissions(grants: AuthenticationGrant[], accountId: string): RelayPermissionGroup[] {
  const groups = new Map<string, RelayPermissionGroup>();
  for (const grant of grants) {
    if (grant.accountId !== accountId || grant.protocol !== 'nip42') continue;
    let group = groups.get(grant.destination);
    if (!group) {
      group = { destination: grant.destination, revision: '', allSites: false, allowedOrigins: [], deniedOrigins: [] };
      groups.set(grant.destination, group);
    }
    if (grant.decision === 'deny') group.deniedOrigins.push(grant.origin);
    else if (grant.origin === '*') group.allSites = true;
    else group.allowedOrigins.push(grant.origin);
  }
  return [...groups.values()].map(group => ({
    ...group,
    revision: relayPermissionRevision(grants, accountId, group.destination),
    allowedOrigins: [...new Set(group.allowedOrigins)].filter(origin => !group.deniedOrigins.includes(origin)).sort(),
    deniedOrigins: [...new Set(group.deniedOrigins)].sort(),
  })).sort((a, b) => a.destination.localeCompare(b.destination));
}

/** Legacy connected hostnames can be offered as an exact HTTPS site to approve. */
export function connectedSiteOrigins(domains: string[]): string[] {
  return [...new Set(domains.flatMap(domain => {
    try {
      const url = new URL(domain.includes('://') ? domain : `https://${domain}`);
      if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
        || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) return [];
      return [url.origin];
    } catch { return []; }
  }))].sort();
}

/** Detect settings changed since the editor opened, including newly saved denials. */
export function relayPermissionRevision(grants: AuthenticationGrant[], accountId: string, destination: string): string {
  return JSON.stringify(grants.filter(grant => grant.accountId === accountId && grant.protocol === 'nip42' && grant.destination === destination)
    .map(grant => [grant.id, grant.origin, grant.decision ?? 'allow']).sort((a, b) => a[0].localeCompare(b[0])));
}
