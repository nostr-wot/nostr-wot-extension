import { DEFAULT_RELAYS } from '@constants/relays.ts';
import {
  ARCHIVE_INTERVAL_OPTIONS,
  MAX_ARCHIVE_GROUPS,
  MAX_ARCHIVE_GROUP_NAME_LENGTH,
  MAX_ARCHIVE_RELAYS_PER_GROUP,
  MAX_ARCHIVE_RELAY_URL_LENGTH,
  DEFAULT_ARCHIVE_SETTINGS,
} from '@constants/archive.ts';
import { type ArchiveSettings } from './types.ts';

/** Only intentional WebSocket destinations; never accept URL credentials or fragments. */
export function archiveRelayUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_ARCHIVE_RELAY_URL_LENGTH)
    throw new Error('Invalid relay URL');
  const url = new URL(value.trim());
  if (!['wss:', 'ws:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error('Invalid relay URL');
  if (url.protocol === 'ws:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('Use wss:// for remote relays');
  return url.toString();
}

export function validateArchiveSettings(value: unknown): ArchiveSettings {
  const v = value as ArchiveSettings;
  if (
    !v ||
    typeof v.automatic !== 'boolean' ||
    typeof v.includeMessages !== 'boolean' ||
    !ARCHIVE_INTERVAL_OPTIONS.some((option) => option.minutes === v.intervalMinutes) ||
    !Array.isArray(v.groups) ||
    v.groups.length > MAX_ARCHIVE_GROUPS
  )
    throw new Error('Invalid archive settings');
  const ids = new Set<string>();
  const groups = v.groups.map((group) => {
    if (
      !group ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(group.id) ||
      ids.has(group.id) ||
      typeof group.name !== 'string' ||
      !group.name.trim() ||
      group.name.length > MAX_ARCHIVE_GROUP_NAME_LENGTH ||
      !Array.isArray(group.relays) ||
      group.relays.length > MAX_ARCHIVE_RELAYS_PER_GROUP
    )
      throw new Error('Invalid relay group');
    ids.add(group.id);
    return { id: group.id, name: group.name.trim(), relays: [...new Set(group.relays.map(archiveRelayUrl))] };
  });
  if (typeof v.selectedGroupId !== 'string' || (groups.length && !ids.has(v.selectedGroupId)))
    throw new Error('Select a relay group');
  if (v.automatic && !groups.find((g) => g.id === v.selectedGroupId)?.relays.length)
    throw new Error('Select at least one relay');
  return {
    automatic: v.automatic,
    intervalMinutes: v.intervalMinutes,
    includeMessages: v.includeMessages,
    groups,
    selectedGroupId: v.selectedGroupId,
  };
}

export function initialArchiveSettings(relays: string[] = []): ArchiveSettings {
  const valid = relays.flatMap((relay) => {
    try {
      return [archiveRelayUrl(relay)];
    } catch {
      return [];
    }
  });
  return {
    ...DEFAULT_ARCHIVE_SETTINGS,
    groups: [
      {
        id: 'profile',
        name: 'Profile relays',
        relays: [...new Set(valid)].slice(0, MAX_ARCHIVE_RELAYS_PER_GROUP),
      },
    ],
    selectedGroupId: 'profile',
  };
}
export function archiveRelays(settings: ArchiveSettings): string[] {
  return settings.groups.find((g) => g.id === settings.selectedGroupId)?.relays ?? [];
}

export function archiveRelayUrls(value: string): string[] {
  const urls = [...new Set(value.split(/[\s,]+/).filter(Boolean))];
  if (!urls.length) throw new Error('Invalid relay URL');
  try {
    return [...new Set(urls.map(archiveRelayUrl))];
  } catch {
    throw new Error('Invalid relay URL');
  }
}

/** Shared suggestions for archive settings and migration; custom URLs remain allowed. */
export function archiveRelaySuggestions(settings: ArchiveSettings): string[] {
  return [...new Set([...DEFAULT_RELAYS.map(archiveRelayUrl), ...settings.groups.flatMap(group => group.relays)])];
}
