import { DEFAULT_RELAYS } from './defaultRelays.ts';

export interface RelayConfiguration {
  relays: string[];
  flags: Record<string, { read: boolean; write: boolean }>;
}

/** NIP-65: no marker means both; duplicate read/write tags combine. */
export function parseRelayList(tags: string[][]): RelayConfiguration {
  const flags: RelayConfiguration['flags'] = {};
  for (const [tag, url, marker] of tags) {
    if (tag !== 'r' || !url || (marker && marker !== 'read' && marker !== 'write')) continue;
    try { if (!['wss:', 'ws:'].includes(new URL(url).protocol)) continue; } catch { continue; }
    const previous = flags[url];
    flags[url] = { read: !!previous?.read || marker !== 'write', write: !!previous?.write || marker !== 'read' };
  }
  return { relays: Object.keys(flags), flags };
}

export function sameRelayList(a: RelayConfiguration, b: RelayConfiguration): boolean {
  return a.relays.length === b.relays.length && a.relays.every(url => {
    if (!b.relays.includes(url)) return false;
    const x = a.flags[url] || { read: true, write: true };
    const y = b.flags[url] || { read: true, write: true };
    return x.read === y.read && x.write === y.write;
  });
}

/** Missing storage uses the same defaults everywhere; an explicit empty string stays empty. */
export function configuredRelayUrls(value: unknown): string[] {
  return [...new Set((typeof value === 'string' ? value : DEFAULT_RELAYS).split(',').map(url => url.trim()).filter(Boolean))];
}

/** Build exactly the configuration shown in the editor, rejecting accidental erasure. */
export function relayPublicationTags(configuration: RelayConfiguration): string[][] {
  if (!Array.isArray(configuration?.relays)) throw new Error('Invalid relay configuration');
  const tags: string[][] = [];
  for (const url of new Set(configuration.relays)) {
    if (typeof url !== 'string' || !['wss:', 'ws:'].includes(new URL(url).protocol)) throw new Error('Invalid relay URL');
    const flags = configuration.flags?.[url] || { read: true, write: true };
    if (flags.read && flags.write) tags.push(['r', url]);
    else if (flags.read) tags.push(['r', url, 'read']);
    else if (flags.write) tags.push(['r', url, 'write']);
  }
  if (!tags.length) throw new Error('Cannot publish an empty relay list. Enable at least one relay.');
  return tags;
}
