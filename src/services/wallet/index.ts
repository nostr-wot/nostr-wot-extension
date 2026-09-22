/**
 * Wallet provider factory with per-account caching
 *
 * Creates and caches WalletProvider instances keyed by account ID.
 * Pattern mirrors `_nip46Clients` map in `services/signing/signer.ts`.
 *
 * NWC providers receive the shared signing and NIP-04 crypto implementation
 * here, so cold startup and reconnect use the same construction path.
 *
 * @module services/wallet/index
 */

import type { WalletConfig, WalletProvider } from '../../domain/wallet/types.ts';
import { LnbitsProvider } from './lnbits.ts';
import { NwcProvider } from './nwc.ts';
import { nip04Encrypt, nip04Decrypt } from '../../lib/crypto/nip04.ts';
import { getPublicKey } from '../../lib/crypto/secp256k1.ts';
import { signEvent } from '../../lib/crypto/nip01.ts';
import { hexToBytes } from '../../lib/crypto/utils.ts';
import { onSessionInvalidated } from '../vault/vault.ts';

// ── Per-account provider cache ──

const _providers: Map<string, WalletProvider> = new Map();
onSessionInvalidated(clearWalletProviders);

export function isWalletProviderCurrent(accountId: string, provider: WalletProvider): boolean {
  return _providers.get(accountId) === provider;
}

/**
 * Get a cached WalletProvider for the given account, or create one.
 *
 * Returns null if config is undefined/null.
 * For 'lnbits' configs, creates an LnbitsProvider directly.
 * For 'nwc' configs, validates the connection keys and injects shared crypto.
 */
export function getWalletProvider(
  accountId: string,
  config: WalletConfig | undefined | null,
): WalletProvider | null {
  if (config === undefined || config === null) {
    return null;
  }

  const cached = _providers.get(accountId);
  if (cached) {
    return cached;
  }

  const provider = createWalletProvider(config);
  if (provider) _providers.set(accountId, provider);
  return provider;
}

/** Construct an uncached provider for validating credentials before saving them. */
export function createWalletProvider(config: WalletConfig): WalletProvider | null {
  if (config.type === 'lnbits') {
    const provider = new LnbitsProvider({
      instanceUrl: config.instanceUrl,
      adminKey: config.adminKey,
    });
    return provider;
  }

  if (config.type === 'nwc') {
    const parsed = NwcProvider.parseConnectionString(config.connectionString);
    if (!/^[0-9a-f]{64}$/i.test(parsed.secret) || !/^[0-9a-f]{64}$/i.test(parsed.walletPubkey)) {
      throw new Error('Invalid NWC connection keys');
    }
    const provider = new NwcProvider(config, hexToBytes(parsed.secret), {
      encrypt: nip04Encrypt,
      decrypt: nip04Decrypt,
      getPubkey: getPublicKey,
      signEvent,
    });
    return provider;
  }

  return null;
}

/**
 * Cache an externally-created provider (e.g. NwcProvider with injected deps).
 */
export function setWalletProvider(accountId: string, provider: WalletProvider): void {
  _providers.set(accountId, provider);
}

/**
 * Disconnect and remove a cached provider.
 */
export function removeWalletProvider(accountId: string): void {
  const provider = _providers.get(accountId);
  if (provider) {
    provider.disconnect();
    _providers.delete(accountId);
  }
}

/**
 * Disconnect all cached providers and clear the cache.
 * Called on vault lock to ensure no stale connections remain.
 */
export function clearWalletProviders(): void {
  for (const provider of _providers.values()) {
    provider.disconnect();
  }
  _providers.clear();
}

/**
 * Returns true if the config is defined and not null (i.e. a wallet is configured).
 */
export function hasWalletConfig(config: WalletConfig | undefined | null): boolean {
  return config !== undefined && config !== null;
}
