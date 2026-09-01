import React, { useState, useEffect, useCallback, useRef } from 'react';
import browser from '@shared/browser.ts';
import { rpc } from '@shared/rpc.ts';
import { resolveActiveTabDomain } from '@shared/activeTabDomain.ts';
import { formatSats } from '@shared/format/number.ts';
import { resolveSiteState } from '@shared/siteState.ts';
import { t } from '@lib/i18n.js';
import { useAccount } from '../../context/AccountContext';
import { useVault } from '../../context/VaultContext';
import SiteControls from './SiteControls';
import ProfileCard from './ProfileCard';
import MutesCard from './MutesCard';
import PqcCard from './PqcCard';
import RelaysCard from './RelaysCard';
import Card from '@components/Card/Card';
import Button from '@components/Button/Button';
import EmptyState from '@components/EmptyState/EmptyState';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import { IconGlobe, IconZap, IconChevronRight } from '@assets';
import styles from './HomeTab.module.css';
import type { PendingRequest } from '@lib/types.ts';

interface HomeTabProps {
  onViewAllActivity: (domain: string | null) => void;
  onManagePermissions: (domain: string) => void;
  onManageFilters: () => void;
  onEditProfile: () => void;
  onOpenRelays: () => void;
  onOpenPqc: () => void;
  onOpenWallet: () => void;
  menuOpen?: boolean;
}

interface Account {
  id: string;
  pubkey: string;
  name?: string;
  readOnly?: boolean;
  type?: string;
}

// ── Custom hooks (extracted from HomeTab state) ──

function useSiteState(active: Account | null) {
  const [domain, setDomain] = useState<string | null>(null);
  const [siteState, setSiteState] = useState<string | null>(null); // null = loading, 'empty' | 'notConnected' | 'connected' | 'error'
  const [identityEnabled, setIdentityEnabled] = useState<boolean>(true);

  // Which run of loadHomeState is the current one. Without this the slower of
  // two overlapping runs wins simply by finishing last, and paints its stale
  // answer over the newer one.
  const runRef = useRef(0);

  const loadHomeState = useCallback(async () => {
    const run = ++runRef.current;
    const current = () => run === runRef.current;

    // Re-enter the loading state so re-runs (e.g. when `active` resolves) don't
    // linger on a stale connected view while async detection is in flight.
    setSiteState(null);
    let resolvedDomain: string | null = null;
    try {
      // Not tab.url: the browser withholds it from us on a site we hold no host
      // permission for, which is now every site. See shared/activeTabDomain.
      const { domain: d, restricted } = await resolveActiveTabDomain();
      if (!current()) return;
      if (restricted || !d) {
        setSiteState('empty');
        return;
      }
      resolvedDomain = d;
      setDomain(d);

      const [allowedR, identityR] = await Promise.allSettled([
        rpc<string[]>('getAllowedDomains'),
        rpc<string[]>('getIdentityDisabledSites'),
      ]);
      if (!current()) return;

      const allowedDomains = allowedR.status === 'fulfilled' ? (allowedR.value || []) : null;
      const identityDisabled = identityR.status === 'fulfilled' ? (identityR.value || []) : [];

      const state = resolveSiteState(allowedDomains, d);
      if (state === 'error') {
        setSiteState('error');
        return;
      }

      const identityDisabledSet = new Set<string>(identityDisabled || []);

      setIdentityEnabled(!identityDisabledSet.has(d));

      setSiteState(state);
    } catch {
      if (!current()) return;
      setSiteState(resolvedDomain ? 'error' : 'empty');
    }
  }, []);

  // `active.id`, not `active`. AccountContext recomputes `active` with
  // `accounts.find(...)` on every render, so any write it watches — including a
  // profileCache write, which happens whenever a profile resolves — hands this
  // effect a new object identity for the same account. It then re-ran the whole
  // detection, reset siteState to null ("Loading…"), and remounted every card
  // below, each of which re-fired its own fetches. With several accounts that is
  // the same work several times over on a single popup open.
  //
  // loadHomeState never reads `active`; it only needed to re-run when the
  // account genuinely changes.
  useEffect(() => {
    loadHomeState();
  }, [active?.id, loadHomeState]);

  // The allowlist can change while this view is mounted — from the globe button
  // in the top bar, or from the background — and the card kept showing whatever
  // it decided when it loaded. That is how the globe and the home card ended up
  // contradicting each other inside one 380px window: the dot went green while
  // the card below it still offered Connect.
  //
  // storage.onChanged rather than a runtime message: runtime messages are not
  // delivered back to the document that sent them, so the popup cannot notify
  // itself this way. See docs/component-standards.md §9.
  useEffect(() => {
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area !== 'local') return;
      if (changes.allowedDomains || changes.identityDisabledSites) loadHomeState();
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [loadHomeState]);

  return { domain, siteState, identityEnabled, setIdentityEnabled, loadHomeState };
}

function useWalletBanner(active: Account | null, canUseWallet: boolean | null, menuOpen?: boolean) {
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

// ── HomeTab component ──

export default function HomeTab({ onViewAllActivity, onManagePermissions, onManageFilters, onEditProfile, onOpenRelays, onOpenPqc, onOpenWallet, menuOpen }: HomeTabProps) {
  const { active, cachedProfile, isReadOnly, isNip46 } = useAccount();
  const { locked } = useVault();

  // Pending requests count
  const [pendingCount, setPendingCount] = useState(0);

  // Extracted hooks
  const { domain, siteState, identityEnabled, setIdentityEnabled, loadHomeState } = useSiteState(active);

  // Wallet is only available for unlocked signing accounts (generated/nsec)
  const canUseWallet = active && !isReadOnly && !isNip46 && !locked;
  const { walletState, walletDismissed, setWalletDismissed } = useWalletBanner(active, canUseWallet, menuOpen);

  const pendingRunRef = useRef(0);
  useEffect(() => {
    async function checkPending() {
      const run = ++pendingRunRef.current;
      try {
        const pending: PendingRequest[] = await rpc('signer_getPending') || [];
        if (run !== pendingRunRef.current) return;
        const actionable = pending.filter((r) => (r.needsPermission || r.waitingForUnlock) && !r.nip46InFlight);
        setPendingCount(actionable.length);
      } catch {
        // A failed read is not "no pending requests". Zeroing the badge on a
        // transport failure hides the queue instead of reporting it; keep the
        // last count we actually managed to read.
        if (run !== pendingRunRef.current) return;
      }
    }
    checkPending();
    const listener = (message: { type?: string }) => {
      if (message.type === 'signerPendingUpdated') checkPending();
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  const handleIdentityToggle = async (checked: boolean) => {
    setIdentityEnabled(checked);
    await rpc('setIdentityDisabled', { domain, disabled: !checked });
  };

  // Connecting is one step: the click. The extension used to also ask the browser for
  // per-site host access, but that dialog gated nothing (identity release is decided by
  // the allowlist this RPC writes), it dismissed the popup and lost the click, and the
  // fix for that released the identity while the dialog was still unanswered.
  const handleConnect = async () => {
    if (!domain) return;
    try {
      await rpc('connectDomain', { domain });
    } finally {
      loadHomeState();
    }
  };

  // "Not now": record the dismissal so the site's next request is rejected
  // silently instead of re-opening the popup, then get out of the way.
  //
  // "Not now" lasts as long as the user chose in Settings (a week by default) rather than
  // forever, and "Never" is explicit. Both are listed in Settings with an undo — this used
  // to be a permanent, invisible dead end whose only escape was discovering that connecting
  // cleared it.
  const handleDismiss = async (permanent = false) => {
    if (!domain) return;
    try {
      await rpc('addDismissedDomain', { domain, permanent });
    } finally {
      window.close();
    }
  };

  // Profile card shows for signing accounts (can edit kind:0)
  const canEditProfile = !!active && !isReadOnly;

  const handleDismissWallet = async () => {
    if (!active?.id) return;
    setWalletDismissed(true);
    const data = await browser.storage.local.get('walletBannerDismissed');
    const dismissed = (data as Record<string, unknown>).walletBannerDismissed;
    const list: string[] = Array.isArray(dismissed) ? dismissed : [];
    if (!list.includes(active.id)) list.push(active.id);
    await browser.storage.local.set({ walletBannerDismissed: list });
  };

  // Show wallet setup banner only after the profile banner is gone, and only for signing accounts
  const showWalletBanner = canUseWallet && walletState === false && !walletDismissed;

  if (siteState === 'empty') {
    return (
      <div className={styles.centerWrap}>
        <Card className={styles.emptyState}>
          <EmptyState
            icon={
              <IconGlobe size={32} strokeWidth="1.5" />
            }
            text={t('home.navigateToConnect')}
            hint={t('home.siteControlsHint')}
          />
        </Card>
      </div>
    );
  }

  if (siteState === null) {
    return (
      <div className={styles.centerWrap}>
        <Card className={styles.emptyState}>
          <EmptyState
            icon={
              <IconGlobe size={32} strokeWidth="1.5" />
            }
            text={t('common.loading')}
          />
        </Card>
      </div>
    );
  }

  if (siteState === 'notConnected') {
    return (
      <div className={styles.centerWrap}>
        <Card className={styles.emptyState}>
          <EmptyState
            icon={
              <IconGlobe size={32} strokeWidth="1.5" />
            }
            text={domain!}
            hint={t('home.siteNotConnected')}
          >
            <div className={styles.connectActions}>
              <Button small onClick={handleConnect}>{t('home.connectThisSite')}</Button>
              <Button small variant="secondary" onClick={() => handleDismiss(false)}>{t('home.notNow')}</Button>
              <Button small variant="secondary" onClick={() => handleDismiss(true)}>{t('home.never')}</Button>
            </div>
          </EmptyState>
        </Card>
      </div>
    );
  }

  return (
    <>
      {pendingCount > 0 && (
        <Card className={styles.pendingCard}>
          <div className={styles.pendingInfo}>
            <span className={styles.pendingBadge}>{pendingCount}</span>
            <span className={styles.pendingText}>{t('unlock.pendingCount', { count: pendingCount })}</span>
          </div>
        </Card>
      )}
      {/* Wallet — on top: balance card when a wallet exists, else the setup prompt */}
      {walletState && typeof walletState === 'object' && (
        <Card className={styles.walletCard} onClick={onOpenWallet}>
          <div className={styles.walletCardInfo}>
            <IconZap size={14} className={styles.walletCardIcon} />
            <div className={styles.walletCardText}>
              <strong>{formatSats(walletState.balance)}</strong>
              <span>{t('wallet.balance')}</span>
            </div>
          </div>
          <IconChevronRight size={16} />
        </Card>
      )}

      {showWalletBanner && (
        <Card className={styles.profileSuggestion}>
          <div className={styles.profileSuggestionContent}>
            <IconZap size={14} className={styles.profileSuggestionIcon} />
            <div className={styles.profileSuggestionText}>
              <strong>{t('wallet.setupBanner')}</strong>
              <span>{t('wallet.setupBannerHint')}</span>
            </div>
          </div>
          <div className={styles.profileSuggestionActions}>
            <Button small onClick={onOpenWallet}>{t('home.setupProfileButton')}</Button>
            <button className={styles.profileDismiss} onClick={handleDismissWallet}>{t('home.skip')}</button>
          </div>
        </Card>
      )}

      {/* Identity access for the current site */}
      {siteState === 'error' ? (
        <Card className={styles.emptyState}>
          <EmptyState
            icon={<IconGlobe size={32} strokeWidth="1.5" />}
            text={domain ?? ''}
            hint={t('home.siteInfoError')}
          >
            <Button small onClick={loadHomeState}>{t('home.retry')}</Button>
          </EmptyState>
        </Card>
      ) : (
        <SiteControls
          identityEnabled={identityEnabled}
          isNip46={isNip46}
          onIdentityToggle={handleIdentityToggle}
          onManagePermissions={() => onManagePermissions(domain!)}
          onRecentActivity={() => onViewAllActivity(domain)}
        />
      )}

      {/* Account — profile, mutes, and relays that follow the identity, grouped
          into one card so they read as a single list. */}
      {active && (
        <div className={styles.accountSection}>
          <SectionLabel>{t('home.account')}</SectionLabel>
          <Card className={styles.accountCard}>
            {canEditProfile && <ProfileCard onEdit={onEditProfile} />}
            <MutesCard onOpen={onManageFilters} />
            <RelaysCard onOpen={onOpenRelays} />
            {/* Last in the list: the everyday rows people came for come first, and
                post-quantum setup is a once-per-identity errand. */}
            <PqcCard onOpen={onOpenPqc} />
          </Card>
        </div>
      )}
    </>
  );
}
