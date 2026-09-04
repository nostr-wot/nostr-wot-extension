import { useState, useEffect, useRef } from 'react';
import browser from '@shared/browser.ts';
import { useWallet } from '@popup/context/WalletContext';
import type { Account } from '@models/account.ts';

/**
 * Whether to offer the wallet on the home screen, and whether the user has
 * dismissed that offer.
 *
 * The wallet reads themselves come from WalletContext now. This hook had its
 * own `wallet_hasConfig` + `wallet_getBalance` pair, so opening the popup paid
 * for the same two round trips the wallet section was already making — one of
 * them an NWC call over a relay.
 */
export default function useWalletBanner(
  active: Account | null,
  canUseWallet: boolean | null,
  menuOpen?: boolean,
) {
  const { configType, balance, refreshBalance, refreshConfig } = useWallet();
  const [walletDismissed, setWalletDismissed] = useState<boolean>(false);

  // `null` is unknown — not fetched yet, or the read failed. It must not
  // collapse into `false`: that is a claim this account has no wallet, and it
  // showed "set up a wallet" to someone who already had one.
  const walletState: null | false | { balance: number } =
    !canUseWallet || configType === null ? null
      : configType === false ? false
        : { balance: balance ?? 0 };

  useEffect(() => {
    if (!active?.id || !canUseWallet) { setWalletDismissed(false); return; }
    browser.storage.local.get('walletBannerDismissed').then((data) => {
      const dismissed = (data as Record<string, unknown>).walletBannerDismissed;
      const list: string[] = Array.isArray(dismissed) ? dismissed : [];
      setWalletDismissed(list.includes(active.id));
    });
  }, [active?.id, canUseWallet]);

  // Re-check when the menu overlay *closes*, e.g. after wallet setup. Keyed on
  // the transition, not the value: `menuOpen` starts out false, so keying on the
  // value fired on mount alongside the provider's own fetch and every popup open
  // paid for two round trips instead of one.
  const prevMenuOpenRef = useRef<boolean | undefined>(menuOpen);
  useEffect(() => {
    const was = prevMenuOpenRef.current;
    prevMenuOpenRef.current = menuOpen;
    if (was === true && menuOpen === false && canUseWallet) {
      refreshConfig();
      refreshBalance();
    }
  }, [menuOpen, canUseWallet, refreshConfig, refreshBalance]);

  return { walletState, walletDismissed, setWalletDismissed };
}
