export interface ConnectionDraft { name: string; dailyLimit: number; days: number; }
export interface AppConnection {
  pubkey: string; name: string; expiresAt: number; createdAt: number; lastUsed: number;
  permissions: string[]; budgets: {limitSats: number; usedSats: number; seconds: number}[];
  canCopy?: boolean;
}
export interface ConnectionProvider { pubkey: string; relay: string; }
export const connectionKey = (id: string) => `walletAppConnections:${id}`;
export const validConnectionKey = (key: unknown): key is string => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
export function validateConnectionDraft(value: ConnectionDraft): ConnectionDraft {
  if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 50 || [...value.name].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)
    || !Number.isSafeInteger(value.dailyLimit) || value.dailyLimit <= 0 || value.dailyLimit >= 10_000_000
    || !Number.isSafeInteger(value.days) || value.days < 1 || value.days > 365) throw new Error('Invalid connection name, limit or expiry');
  return {name:value.name.trim(),dailyLimit:value.dailyLimit,days:value.days};
}
export function pairingUri(provider: ConnectionProvider, secret: string): string {
  if (!validConnectionKey(provider?.pubkey) || !validConnectionKey(secret)) throw new Error('Invalid connection key');
  const relay = new URL(provider.relay);
  if (relay.protocol !== 'wss:' || relay.username || relay.password || relay.hash) throw new Error('Invalid NWC relay');
  return `nostr+walletconnect://${provider.pubkey}?${new URLSearchParams({relay:provider.relay,secret})}`;
}
export function parseConnections(value: unknown, now = Date.now()/1000): AppConnection[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid connection list');
  return value.map(row => {
    const d=row?.data;
    if (!validConnectionKey(d?.pubkey) || typeof d.description !== 'string' || typeof d.permissions !== 'string'
      || ![d.expires_at,d.created_at,d.last_used ?? 0].every(n=>Number.isSafeInteger(n)&&n>=0) || !Array.isArray(row.budgets)) throw new Error('Invalid connection response');
    return {pubkey:d.pubkey,name:d.description.slice(0,100),expiresAt:d.expires_at,createdAt:d.created_at,lastUsed:d.last_used || 0,
      permissions:d.permissions.split(' '),budgets:row.budgets.map((b: {budget_msats:number;used_budget_msats:number;refresh_window:number})=>{
        if (![b.budget_msats,b.used_budget_msats ?? 0,b.refresh_window].every(n=>Number.isSafeInteger(n)&&n>=0)) throw new Error('Invalid connection budget');
        return {limitSats:b.budget_msats/1000,usedSats:(b.used_budget_msats || 0)/1000,seconds:b.refresh_window};
      })};
  }).filter(c=>!c.expiresAt || c.expiresAt>now);
}
