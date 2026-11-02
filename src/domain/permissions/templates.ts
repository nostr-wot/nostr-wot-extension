import type { PermissionBucket } from './types';
import { DM_SIGN_KINDS } from '@constants/permissions';

export interface PermissionTemplate { id: string; name: string; rules: PermissionBucket; }
const allow = (...kinds: number[]): PermissionBucket => Object.fromEntries(kinds.map(kind => [`signEvent:${kind}`, 'allow']));
export const WOT_TEMPLATE_KEYS = ['wot_getStatus', 'wot_getFollows', 'wot_getDistanceBatch'] as const;
export const TEMPLATE_PRESETS: PermissionTemplate[] = [
  { id: 'playground', name: 'templates.playground', rules: { wot_getStatus: 'allow', wot_getFollows: 'allow', wot_getDistanceBatch: 'allow' } },
  { id: 'social', name: 'templates.social', rules: { ...allow(1, 6, 7, 16, 1111, 30023, 30078), 'signEvent:0': 'ask', 'signEvent:3': 'ask', 'signEvent:5': 'ask' } },
  { id: 'dm', name: 'templates.dm', rules: { readMessages: 'allow', sendMessages: 'allow' } },
  { id: 'groups', name: 'templates.groups', rules: { ...allow(9, 11, 7), 'signEvent:9021': 'ask', 'signEvent:9022': 'ask', 'signEvent:9007': 'ask', 'signEvent:9005': 'ask' } },
  { id: 'publishing', name: 'templates.publishing', rules: { ...allow(30023, 30024, 1111), 'signEvent:5': 'ask' } },
  { id: 'preferences', name: 'templates.preferences', rules: allow(30078) },
];
/** Suggestions only. Exact origins never inherit another hostname's recognition. */
export const TEMPLATE_SITES = [
  { origin: 'https://sky.obelisk.ar', name: 'Obelisk Sky', presets: ['groups', 'dm'] },
  { origin: 'https://obelisk.ar', name: 'Obelisk', presets: ['groups', 'dm'] },
  { origin: 'https://lawallet.io', name: 'LAWallet', presets: [] },
  { origin: 'https://nostrwot.com', name: 'Nostr WoT', presets: ['playground'] },
  { origin: 'https://primal.net', name: 'Primal', presets: ['social'] },
  { origin: 'https://coracle.social', name: 'Coracle', presets: ['social'] },
  { origin: 'https://nostrich.org', name: 'Nostrich', presets: ['social'] },
  { origin: 'https://snort.social', name: 'Snort', presets: ['social'] },
  { origin: 'https://yakihonne.com', name: 'YakiHonne', presets: ['publishing', 'social'] },
  { origin: 'https://chachi.chat', name: 'Chachi', presets: ['groups'] },
];
export function siteTemplate(origin: string) { return TEMPLATE_SITES.find(site => site.origin === origin); }
export function recommendedRules(origin: string): PermissionBucket {
  return Object.assign({}, ...(siteTemplate(origin)?.presets ?? []).map(id => TEMPLATE_PRESETS.find(p => p.id === id)!.rules));
}
export function validateTemplateRules(value: unknown): PermissionBucket {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 100) throw new Error('Invalid permission template');
  const rules: PermissionBucket = {};
  for (const [key, decision] of Object.entries(value)) {
    const match = /^signEvent:(0|[1-9]\d{0,4})$/.exec(key);
    const validKind = match && Number(match[1]) <= 65535 && !DM_SIGN_KINDS.has(Number(match[1]));
    if (!(validKind || (WOT_TEMPLATE_KEYS as readonly string[]).includes(key) || key === 'readMessages' || key === 'sendMessages') || !['allow', 'ask', 'deny'].includes(decision as string)) throw new Error('Invalid template permission');
    rules[key] = decision as PermissionBucket[string];
  }
  return rules;
}
export function validateTemplate(value: unknown): PermissionTemplate {
  const template = value as PermissionTemplate;
  if (!template || typeof template.id !== 'string' || !/^custom-[a-zA-Z0-9-]{1,64}$/.test(template.id) || typeof template.name !== 'string' || !template.name.trim() || template.name.length > 80) throw new Error('Invalid template name');
  return { id: template.id, name: template.name.trim(), rules: validateTemplateRules(template.rules) };
}

/** Combine selected presets without weakening a more restrictive decision. */
export function combineTemplateRules(templates: Array<{ rules: PermissionBucket }>): PermissionBucket {
  const result: PermissionBucket = {};
  const rank = { allow: 0, ask: 1, deny: 2 };
  for (const template of templates) for (const [key, decision] of Object.entries(template.rules)) {
    if (!(key in result) || rank[decision] > rank[result[key]]) result[key] = decision;
  }
  return result;
}
