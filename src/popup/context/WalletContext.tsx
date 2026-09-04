import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { rpc } from '@shared/rpc.ts';
import { useAccount } from './AccountContext';

interface WalletContextValue {
  /** `string` = provider type (configured), `false` = no wallet, `null` = unknown
   *  (not fetched yet, or the last read failed). */
  configType: string | false | null;
  /** True when the most recent config read threw. Kept separate from
   *  `configType` rather than coerced into `false` — WalletSection used to do
   *  that and rendered the whole "connect a wallet" flow over a wallet that was
   *  already connected, on nothing worse than a cold service worker. */
  configReadFailed: boolean;
  /** `null` = unknown (no wallet, not fetched yet, or the last read failed). */
  balance: number | null;
  balanceLoading: boolean;
  balanceError: string;
  refreshConfig: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  /** Optimistic: call right after `wallet_disconnect` resolves so the UI does
   *  not wait on a round trip to know the wallet it just disconnected is gone. */
  markDisconnected: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

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
 */
export function WalletProvider({ children }: WalletProviderProps) {
  const { active } = useAccount();
  const [configType, setConfigType] = useState<string | false | null>(null);
  const [configReadFailed, setConfigReadFailed] = useState<boolean>(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState<boolean>(false);
  const [balanceError, setBalanceError] = useState<string>('');

  const refreshConfig = useCallback(async () => {
    setConfigReadFailed(false);
    try {
      const result = await rpc<string | false>('wallet_hasConfig');
      setConfigType(result || false);
    } catch {
      // Leave `configType` at its last known value — a failed RPC cannot prove
      // the wallet is gone, only that we do not currently know.
      setConfigReadFailed(true);
    }
  }, []);

  const refreshBalance = useCallback(async () => {
    setBalanceLoading(true);
    setBalanceError('');
    try {
      const result = await rpc<{ balance: number }>('wallet_getBalance');
      setBalance(result?.balance ?? 0);
    } catch (e: unknown) {
      setBalanceError((e as Error).message);
    }
    setBalanceLoading(false);
  }, []);

  const markDisconnected = useCallback(() => {
    setConfigType(false);
    setBalance(null);
  }, []);

  // Wallet config is per-account. Key on the id, not the `active` object — it
  // is recomputed with `.find()` on every AccountContext render, so an effect
  // keyed on the object re-runs on unrelated writes (docs §9).
  useEffect(() => {
    if (!active?.id) return;
    refreshConfig();
  }, [active?.id, refreshConfig]);

  // Only a configured wallet has a balance to fetch. This also picks up the
  // config check above, so switching to an account with no wallet clears a
  // stale balance instead of leaving the previous account's number on screen.
  useEffect(() => {
    if (typeof configType === 'string') {
      refreshBalance();
    } else {
      setBalance(null);
    }
  }, [configType, refreshBalance]);

  const value: WalletContextValue = {
    configType,
    configReadFailed,
    balance,
    balanceLoading,
    balanceError,
    refreshConfig,
    refreshBalance,
    markDisconnected,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
