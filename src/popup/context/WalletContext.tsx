import React, { useCallback, useEffect, type ReactNode } from 'react';
import { rpc } from '@shared/rpc.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import createRequiredContext from '@utils/createRequiredContext.ts';
import { useAccount } from './AccountContext';

interface ConfigData {
  /** `string` = provider type (configured), `false` = no wallet, `null` =
   *  unknown (not fetched yet, or the last read failed). */
  configType: string | false | null;
}

interface BalanceData {
  /** `null` = unknown (no wallet, not fetched yet, or the last read failed). */
  balance: number | null;
}

interface WalletContextValue {
  configType: string | false | null;
  /** True when the most recent config read threw. Kept separate from
   *  `configType` rather than coerced into `false` — WalletSection used to do
   *  that and rendered the whole "connect a wallet" flow over a wallet that was
   *  already connected, on nothing worse than a cold service worker. */
  configReadFailed: boolean;
  balance: number | null;
  balanceLoading: boolean;
  balanceError: string;
  refreshConfig: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  /** Optimistic: call right after `wallet_disconnect` resolves so the UI does
   *  not wait on a round trip to know the wallet it just disconnected is gone. */
  markDisconnected: () => void;
}

const [WalletContext, useWallet] = createRequiredContext<WalletContextValue>('useWallet');

interface WalletProviderProps {
  children: ReactNode;
}

/**
 * Wallet config presence and balance, fetched once here instead of by every
 * surface that needs them.
 *
 * Before this, `WalletSection` asked `wallet_hasConfig` on its own mount,
 * `Wallet` fetched the balance on its own mount, and `useWalletBanner` (Home)
 * asked both questions again independently — three round trips for two facts,
 * and no shared answer between them.
 *
 * Config and balance are two separate resources, not one: `refreshBalance` is
 * called on its own after a payment, and folding it into a single combined
 * read would repeat the config round trip every time a caller only wants a
 * fresher balance.
 */
export function WalletProvider({ children }: WalletProviderProps) {
  const { active } = useAccount();

  const {
    data: configData, error: configError, refresh: refreshConfig, patch: patchConfig,
  } = useAsyncResource<ConfigData>(
    { configType: null },
    {
      // Wallet config is per-account. Key on the id, not the `active` object —
      // it is recomputed with `.find()` on every AccountContext render, so an
      // effect keyed on the object re-runs on unrelated writes (docs §9).
      deps: [active?.id],
      enabled: !!active?.id,
      load: async (patch) => {
        // A failed RPC cannot prove the wallet is gone, only that we do not
        // currently know — leave `configType` at its last known value rather
        // than coercing the failure into `false` (docs §9: a failed read is
        // unknown, not a negative answer).
        const result = await rpc<string | false>('wallet_hasConfig');
        patch({ configType: result || false });
      },
    },
  );

  const {
    data: balanceData, loading: balanceLoading, error: balanceError, refresh: refreshBalance, patch: patchBalance,
  } = useAsyncResource<BalanceData>(
    { balance: null },
    {
      // Only a configured wallet has a balance to fetch.
      enabled: typeof configData.configType === 'string',
      deps: [configData.configType],
      load: async (patch) => {
        const result = await rpc<{ balance: number }>('wallet_getBalance');
        patch({ balance: result?.balance ?? 0 });
      },
    },
  );

  // The balance resource's `enabled` flag stops it from fetching once there
  // is no wallet, but does not clear a stale balance left over from a
  // previous account — that reset is context-specific, so it stays an
  // explicit line here rather than a side effect of `enabled` in the
  // generic (see useAsyncResource's note on `enabled`).
  useEffect(() => {
    if (typeof configData.configType !== 'string') patchBalance({ balance: null });
  }, [configData.configType, patchBalance]);

  const markDisconnected = useCallback(() => {
    patchConfig({ configType: false });
    patchBalance({ balance: null });
  }, [patchConfig, patchBalance]);

  const value: WalletContextValue = {
    configType: configData.configType,
    configReadFailed: !!configError,
    balance: balanceData.balance,
    balanceLoading,
    balanceError,
    refreshConfig,
    refreshBalance,
    markDisconnected,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export { useWallet };
