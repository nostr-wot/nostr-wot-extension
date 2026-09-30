import clients from '../../data/auth-clients.json';
import type { UnsignedEvent } from '../nostr/types.ts';

export type AuthenticationScope = 'once' | 'site' | 'connected-sites';
export interface AuthenticationRequest {
  protocol: 'nip98' | 'nip42';
  /** Exact signed URL for review and HTTP permission lookup, including query bytes. */
  url: string;
  destination: string;
  method?: string;
  crossOrigin: boolean;
}

function tag(event: UnsignedEvent, name: string): string {
  const values = event.tags?.filter(item => item[0] === name);
  if (!values || values.length !== 1 || values[0].length !== 2 || !values[0][1]) {
    throw new Error(`Invalid authentication ${name} tag`);
  }
  return values[0][1];
}

/** Reject ambiguous auth rather than asking users to interpret competing tags. */
export function parseAuthentication(event: UnsignedEvent, origin: string, now = Math.floor(Date.now()/1000)): AuthenticationRequest | undefined {
  if (event.kind !== 27235 && event.kind !== 22242) return undefined;
  const relay = event.kind === 22242;
  // Metadata is never evidence of browser attestation, but must not contradict
  // the browser-derived caller that authorized this signing request.
  for (const name of ['origin', 'client-origin']) {
    if (event.tags?.some(item => item[0] === name) && tag(event, name) !== origin) {
      throw new Error(`Invalid authentication ${name} tag`);
    }
  }
  const raw = tag(event, relay ? 'relay' : 'u');
  let url: URL;
  let requester: URL;
  try { url = new URL(raw); requester = new URL(origin); }
  catch { throw new Error('Invalid authentication URL'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'];
  if (requester.origin !== origin || !['https:', 'http:'].includes(requester.protocol)
    || (requester.protocol === 'http:' && !loopback.includes(requester.hostname))
    || (url.protocol !== (relay ? 'wss:' : 'https:') && !(url.protocol === (relay ? 'ws:' : 'http:') && loopback.includes(url.hostname)))
    || url.username || url.password || raw.includes('#') || raw !== raw.trim() || [...raw].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === '\\')) {
    throw new Error('Invalid authentication URL');
  }
  const maxAge = relay ? 600 : 60;
  if (!Number.isInteger(event.created_at) || Math.abs(now-event.created_at) > maxAge) throw new Error('Invalid authentication timestamp');
  if (event.content !== '') throw new Error('Invalid authentication content');
  if (relay) {
    tag(event, 'challenge');
    return {protocol:'nip42',url:raw,destination:url.href,crossOrigin:true};
  }
  const method = tag(event,'method');
  if (!/^[0-9A-Z!#$%&'*+.^_`|~-]+$/.test(method)) throw new Error('Invalid authentication HTTP method');
  const payloads = event.tags.filter(item=>item[0]==='payload');
  if (payloads.length && (payloads.length !== 1 || payloads[0].length !== 2 || !/^[0-9a-f]{64}$/.test(payloads[0][1]))) throw new Error('Invalid authentication payload tag');
  return {protocol:'nip98',url:raw,destination:url.origin,method,crossOrigin:url.origin !== origin};
}

/** Groups only requests for the same exact resource/method, never different destinations. */
export function authenticationKey(auth: AuthenticationRequest): string {
  return JSON.stringify([auth.protocol,auth.url,auth.method ?? '']);
}

export function validAuthenticationScope(auth: AuthenticationRequest, scope: unknown): scope is AuthenticationScope {
  return scope === 'once' || scope === 'site' || (scope === 'connected-sites' && auth.protocol === 'nip42');
}

export interface AuthenticationGrant {
  /** Missing on legacy records means allow. */
  decision?: 'allow' | 'deny';
  id: string;
  accountId: string;
  origin: string;
  protocol: AuthenticationRequest['protocol'];
  destination: string;
  method?: string;
  /** v2 HTTP grants bind the exact signed URL. Legacy allows require new consent. */
  version?: 2;
  resource?: string;
}

/** Generic page signing cannot mint the extension's privileged native wallet tokens. */
export function assertPageAuthenticationPolicy(auth: AuthenticationRequest | undefined): void {
  if (auth?.protocol !== 'nip98') return;
  const url = new URL(auth.url);
  if (url.origin === 'https://zaps.nostr-wot.com'
    && /^\/api\/(?:v2\/)?(?:provision|claim-username|release-username)\/?$/.test(decodeURIComponent(url.pathname))) {
    throw new Error('Native wallet authentication requires the internal wallet flow');
  }
}

/** Exact registry matching shared by the consent notice and opt-in backend policy. */
export function findKnownAuthenticationBackend(origin: string, auth: AuthenticationRequest) {
  return clients.find(client => client.origins.includes(origin) && client.backends.some(backend =>
    backend.origin === auth.destination && backend.auth === auth.protocol));
}
