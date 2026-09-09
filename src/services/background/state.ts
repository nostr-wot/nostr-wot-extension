import type { SafeAccount } from '@domain/accounts/types.ts';
import { DEFAULT_RELAYS } from '@constants/relays.ts';

/**
 * Shared state, constants, and utilities for background handler modules.
 * Follows the same pattern as services/vault/vault.ts (module-level mutable state).
 * @module services/background/state
 */

import { npubDecode } from '../../lib/crypto/bech32.ts';

// ── Config ──

export interface ExtConfig {
    myPubkey: string | null;
    relays: string[];
}

export const config: ExtConfig = {
    myPubkey: null,
    relays: [...DEFAULT_RELAYS],
};

// ── Shared types ──

/** Account entry shape stored in browser.storage.local.accounts */
export type LocalAccountEntry = Pick<SafeAccount, 'id' | 'name' | 'pubkey' | 'type' | 'readOnly'>;

// ── Profile Cache ──

export interface ProfileCacheEntry { metadata: Record<string, unknown>; fetchedAt: number; }
export const profileCache = new Map<string, ProfileCacheEntry>();

// ── Method Sets ──

/**
 * Build the set of privileged methods from handler maps.
 * This is called once at startup by background.ts — any method registered in a handler map
 * is automatically privileged (restricted to internal extension pages only).
 *
 * Methods NOT in handler maps (the page-facing nip07_/webln_ methods) are unprivileged.
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

// ── Handler type ──

export type HandlerFn = (params: Record<string, unknown>) => Promise<unknown>;
