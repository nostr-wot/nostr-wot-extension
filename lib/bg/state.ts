/**
 * Shared state, constants, and utilities for background handler modules.
 * Follows the same pattern as lib/vault.ts (module-level mutable state).
 * @module lib/bg/state
 */

import { npubDecode } from '../crypto/bech32.ts';
import { PROFILE_CACHE_TTL_MS } from '../constants.ts';

// ── Constants ──

export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://nostr-01.yakihonne.com'];

// ── Config ──

export interface ExtConfig {
    myPubkey: string | null;
    relays: string[];
}

export const config: ExtConfig = {
    myPubkey: null,
    relays: DEFAULT_RELAYS,
};

// ── Shared types ──

/** Account entry shape stored in browser.storage.local.accounts */
export interface LocalAccountEntry {
    id: string;
    name: string;
    pubkey: string;
    type: string;
    readOnly: boolean;
}

// ── Graph (deprecated) ──
//
// The trust-graph subsystem was removed. `resetLocalGraph` is retained as a
// no-op so the many account-switching handlers that called it after a DB
// change need not be edited; it has no remaining effect.
export function resetLocalGraph(): void { /* trust-graph removed — no-op */ }

// ── Profile Cache ──

export const PROFILE_CACHE_TTL = PROFILE_CACHE_TTL_MS;
export interface ProfileCacheEntry { metadata: Record<string, unknown>; fetchedAt: number; }
export const profileCache = new Map<string, ProfileCacheEntry>();

// ── Rate Limiting ──

// The only rate-limited methods were trust-graph queries, which have been
// removed. The set is now empty; checkRateLimit always allows. Kept as a stub
// so background.ts's dispatch loop need not change.
export const RATE_LIMITED_METHODS = new Set<string>();

export function checkRateLimit(_method: string): boolean {
    return true;
}

// ── Method Sets ──

export const NIP07_SIGNING_METHODS = new Set([
    'nip07_signEvent', 'nip07_nip04Encrypt', 'nip07_nip04Decrypt',
    'nip07_nip44Encrypt', 'nip07_nip44Decrypt'
]);

/**
 * Build the set of privileged methods from handler maps.
 * This is called once at startup by background.ts — any method registered in a handler map
 * is automatically privileged (restricted to internal extension pages only).
 *
 * Methods NOT in handler maps (e.g. WoT API queries from content scripts) are unprivileged.
 */
export function buildPrivilegedMethods(...handlerMaps: Map<string, HandlerFn>[]): Set<string> {
    const methods = new Set<string>();
    for (const map of handlerMaps) {
        for (const key of map.keys()) {
            methods.add(key);
        }
    }
    return methods;
}

/** Populated at startup by background.ts via buildPrivilegedMethods() */
export let PRIVILEGED_METHODS = new Set<string>();

export function setPrivilegedMethods(methods: Set<string>): void {
    PRIVILEGED_METHODS = methods;
}

// ── Utilities ──

export function isRestrictedUrl(url: string | undefined): boolean {
    return !url || url.startsWith('chrome://') || url.startsWith('edge://') ||
        url.startsWith('about:') || url.startsWith('chrome-extension://') || url.startsWith('moz-extension://');
}

export function npubToHex(npub: string): string | null {
    try { return npubDecode(npub); } catch { return null; }
}

export function sanitizeCSS(css: string): string {
    if (!css) return css;
    return css
        .replace(/@import\b[^;]*;?/gi, '/* @import removed */')
        .replace(/url\s*\([^)]*\)/gi, '/* url() removed */')
        .replace(/expression\s*\([^)]*\)/gi, '/* expression() removed */');
}

// ── Handler type ──

export type HandlerFn = (params: Record<string, unknown>) => Promise<unknown>;
