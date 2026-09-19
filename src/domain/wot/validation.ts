import { npubDecode } from '@lib/crypto/bech32.ts';
import { WOT_DEFAULTS, WOT_SCORING, WOT_MAX_HOPS, WOT_MAX_TARGETS } from '@constants/wot.ts';
import type { WotSettings, WotScoring } from './types.ts';
export function wotPubkey(value: unknown): string {
    if (typeof value !== 'string')
        throw new Error('Invalid WoT pubkey');
    if (value.startsWith('npub1')) {
        try {
            return npubDecode(value);
        }
        catch {
            throw new Error('Invalid WoT pubkey');
        }
    }
    if (!/^[0-9a-f]{64}$/i.test(value))
        throw new Error('Invalid WoT pubkey');
    return value.toLowerCase();
}
export function wotTargets(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > WOT_MAX_TARGETS)
        throw new Error(`WoT batch limit is ${WOT_MAX_TARGETS}`);
    return [...new Set(value.map(wotPubkey))];
}
export function validateWotSettings(input: Partial<WotSettings>): WotSettings {
    const settings = { ...WOT_DEFAULTS, ...input };
    if (settings.maxFollows !== null && (!Number.isSafeInteger(settings.maxFollows) || settings.maxFollows < 1)) throw new Error('Follows per profile limit must be a positive whole number or Unlimited');
    if (settings.maxAuthors !== null && (!Number.isSafeInteger(settings.maxAuthors) || settings.maxAuthors < 1)) throw new Error('Profile limit must be a positive whole number or Unlimited');
    if (settings.maxEdges !== null && (!Number.isSafeInteger(settings.maxEdges) || settings.maxEdges < 1)) throw new Error('Edge limit must be a positive whole number or Unlimited');
    if (typeof settings.autoSync !== 'boolean') throw new Error('Invalid automatic sync flag');
    const scoring = validateWotScoring(settings.scoring);
    if (typeof settings.enabled !== 'boolean')
        throw new Error('Invalid enabled flag');
    if (!['local', 'remote', 'hybrid'].includes(settings.mode))
        throw new Error('Invalid WoT mode');
    if (!Number.isInteger(settings.maxHops) || settings.maxHops < 1 || settings.maxHops > WOT_MAX_HOPS)
        throw new Error(`WoT hops must be 1–${WOT_MAX_HOPS}`);
    if (typeof settings.oracleUrl !== 'string')
        throw new Error('Invalid oracle URL');
    if (settings.oracleUrl) {
        let url: URL;
        try {
            url = new URL(settings.oracleUrl);
        }
        catch {
            throw new Error('Invalid oracle URL');
        }
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
            throw new Error('Oracle URL must use HTTPS without credentials, query or fragment');
        settings.oracleUrl = url.href.replace(/\/+$/, '');
    }
    if (settings.enabled && settings.mode !== 'local' && !settings.oracleUrl)
        throw new Error('Enter an oracle URL');
    return { maxFollows: settings.maxFollows, maxAuthors: settings.maxAuthors, maxEdges: settings.maxEdges, autoSync: settings.autoSync, scoring, enabled: settings.enabled, mode: settings.mode, oracleUrl: settings.oracleUrl, maxHops: settings.maxHops };
}

export function validateWotScoring(input: WotScoring = WOT_SCORING): WotScoring {
    const weights = input?.distanceWeights, bonuses = input?.pathBonus;
    const unit = (value: unknown): number => {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('Score values must be between 0 and 1');
        return value;
    };
    const distanceWeights = { 1: unit(weights?.[1]), 2: unit(weights?.[2]), 3: unit(weights?.[3]), 4: unit(weights?.[4]) };
    if (distanceWeights[1] < distanceWeights[2] || distanceWeights[2] < distanceWeights[3]) throw new Error('Scores must not increase with distance');
    return { distanceWeights, pathBonus: { 2: unit(bonuses?.[2]), 3: unit(bonuses?.[3]), 4: unit(bonuses?.[4]) }, maxPathBonus: unit(input?.maxPathBonus) };
}
