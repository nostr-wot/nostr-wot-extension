/**
 * inject-nip44-schemes.test.ts — the capability marker on window.nostr.nip44
 *
 * inject.ts is an IIFE running in the browser MAIN world, so we cannot import
 * it. Following the pattern in inject-webln.test.ts, we replicate the shape it
 * exposes and assert the contract callers depend on.
 *
 * Why this exists: post-quantum encryption rides an *optional third argument*
 * to `nip44.encrypt`. A signer that supports it and one that has never heard
 * of it are shaped identically, and an unaware signer silently ignores the
 * argument and returns classic ciphertext. A caller that assumed support would
 * then present that as post-quantum — a silent downgrade, which is exactly the
 * failure this scheme exists to prevent. `schemes` is the only way to ask.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/** The nip44 surface as inject.ts builds it. */
function createNip44Surface() {
    return {
        schemes: ['nip44', 'pq'] as readonly string[],
        encrypt: async (_pubkey: string, _plaintext: string, _opts?: unknown) => 'ciphertext',
        decrypt: async (_pubkey: string, _ciphertext: string) => 'plaintext',
    };
}

/** How a consumer detects support (mirrors @nostr-wot/signers' signerSupportsPq). */
function signerSupportsPq(nip44: { schemes?: readonly string[] } | undefined): boolean {
    const schemes = nip44?.schemes;
    return Array.isArray(schemes) && schemes.includes('pq');
}

describe('window.nostr.nip44 capability marker', () => {
    it('advertises the schemes it accepts', () => {
        const nip44 = createNip44Surface();
        assert.ok(Array.isArray(nip44.schemes), 'schemes must be an array');
        assert.ok(nip44.schemes.includes('nip44'), 'classic NIP-44 must be advertised');
        assert.ok(nip44.schemes.includes('pq'), 'post-quantum must be advertised');
    });

    it('lets a caller detect post-quantum support', () => {
        assert.equal(signerSupportsPq(createNip44Surface()), true);
    });

    it('reads as unsupported on a signer that predates the marker', () => {
        // An older extension exposes encrypt/decrypt and no schemes at all.
        const legacy = {
            encrypt: async () => 'ciphertext',
            decrypt: async () => 'plaintext',
        };
        assert.equal(signerSupportsPq(legacy), false);
    });

    it('reads as unsupported when a signer advertises classic only', () => {
        // A signer may deliberately declare that it does NOT do post-quantum.
        // That must be respected, not treated the same as an absent marker.
        assert.equal(signerSupportsPq({ schemes: ['nip44'] }), false);
    });

    it('does not disturb the existing two-argument encrypt contract', async () => {
        const nip44 = createNip44Surface();
        assert.equal(await nip44.encrypt('pubkey', 'hello'), 'ciphertext');
    });
});
