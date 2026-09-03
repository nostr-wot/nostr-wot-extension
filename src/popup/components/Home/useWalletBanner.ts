import { useState, useEffect, useCallback, useRef } from 'react';
import browser from '@shared/browser.ts';
import { rpc } from '@shared/rpc.ts';
import type { Account } from './useSiteState.ts';

/**
 * Whether to offer the wallet, and whether the user has dismissed that offer.
 *
 * Lived inside Home.tsx.
 */
export default function useWalletBanner(active: Account | null, canUseWallet: boolean | null, menuOpen?: boolean) {
  const [walletState, setWalletState] = useState<null | false | { balance: number }>(null);
  const [walletDismissed, setWalletDismissed] = useState<boolean>(false);

  const walletRunRef = useRef(0);
  const checkWallet = useCallback(async () => {
    const run = ++walletRunRef.current;
    const current = () => run === walletRunRef.current;
    try {
      const configType = await rpc<string | false>('wallet_hasConfig');
      if (!current()) return;
      if (!configType) { setWalletState(false); return; }
      const result = await rpc<{ balance: number }>('wallet_getBalance');
      if (!current()) return;
      setWalletState({ balance: result?.balance ?? 0 });
    } catch {
      // `false` here means "this account has no wallet", which is a claim a
      // failed RPC cannot support — it showed "set up a wallet" to someone who
      // already had one. Unknown stays unknown.
      if (!current()) return;
      setWalletState(null);
    }
  }, []);

  useEffect(() => {
    if (!active?.id || !canUseWallet) { setWalletState(null); setWalletDismissed(false); return; }
    checkWallet();
    browser.storage.local.get('walletBannerDismissed').then((data) => {
      const dismissed = (data as Record<string, unknown>).walletBannerDismissed;
      const list: string[] = Array.isArray(dismissed) ? dismissed : [];
      setWalletDismissed(list.includes(active.id));
    });
  }, [active?.id, canUseWallet, checkWallet]);

  // Re-check when the menu overlay *closes*, e.g. after wallet setup. Keyed on
  // the transition, not the value: `menuOpen` starts out false, so this fired on
  // mount alongside the effect above and every popup open paid for two NWC round
  // trips instead of one.
  const prevMenuOpenRef = useRef<boolean | undefined>(menuOpen);
  useEffect(() => {
    const was = prevMenuOpenRef.current;
    prevMenuOpenRef.current = menuOpen;
    if (was === true && menuOpen === false && canUseWallet) {
      checkWallet();
    }
  }, [menuOpen, canUseWallet, checkWallet]);

  return { walletState, walletDismissed, setWalletDismissed };
}

// ── Home component ──
