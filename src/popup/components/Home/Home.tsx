import React, { useState, useEffect, useCallback, useRef } from 'react';
import browser from '@shared/browser.ts';
import { rpc } from '@shared/rpc.ts';
import { resolveActiveTabDomain } from '@shared/activeTabDomain.ts';
import { formatSats } from '@shared/format/number.ts';
import { resolveSiteState } from '@shared/siteState.ts';
import { t } from '@lib/i18n.js';
import { useAccount } from '@popup/context/AccountContext';
import { useVault } from '@popup/context/VaultContext';
import useSiteState, { type Account } from './useSiteState.ts';
import useWalletBanner from './useWalletBanner.ts';
import usePendingCount from './usePendingCount.ts';
import SiteControls from './SiteControls';
import ProfileRow from './ProfileRow';
import MutesRow from './MutesRow';
import PqcCard from './PqcCard';
import RelaysRow from './RelaysRow';
import Card from '@components/Card/Card';
import Button from '@components/Button/Button';
import EmptyState from '@components/EmptyState/EmptyState';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import { IconGlobe, IconZap, IconChevronRight } from '@assets';
import styles from './Home.module.css';
import type { PendingRequest } from '@lib/types.ts';

interface HomeProps {
  onViewAllActivity: (domain: string | null) => void;
  onManagePermissions: (domain: string) => void;
  onManageFilters: () => void;
  onEditProfile: () => void;
  onOpenRelays: () => void;
  onOpenPqc: () => void;
  onOpenWallet: () => void;
  menuOpen?: boolean;
}

export default function Home({ onViewAllActivity, onManagePermissions, onManageFilters, onEditProfile, onOpenRelays, onOpenPqc, onOpenWallet, menuOpen }: HomeProps) {
  const { active, cachedProfile, isReadOnly, isNip46 } = useAccount();
  const { locked } = useVault();

  const pendingCount = usePendingCount();
  const { domain, siteState, identityEnabled, setIdentityEnabled, loadHomeState } = useSiteState(active);

  // Wallet is only available for unlocked signing accounts (generated/nsec)
  const canUseWallet = active && !isReadOnly && !isNip46 && !locked;
  const { walletState, walletDismissed, setWalletDismissed } = useWalletBanner(active, canUseWallet, menuOpen);

  // Set when a connect / dismiss / identity-toggle RPC fails, so the click is
  // not silently lost. All three used to fail without saying anything.
  const [connectFailed, setConnectFailed] = useState<boolean>(false);

  const handleIdentityToggle = async (checked: boolean) => {
    const previous = identityEnabled;
    setIdentityEnabled(checked);
    try {
      await rpc('setIdentityDisabled', { domain, disabled: !checked });
    } catch {
      // A privacy control must not lie. The optimistic flip had no revert, so a
      // failed write left the toggle showing a setting that was never saved —
      // and the one it misreports is whether this site may see the identity.
      setIdentityEnabled(previous);
      setConnectFailed(true);
    }
  };

  // Connecting is one step: the click. The extension used to also ask the browser for
  // per-site host access, but that dialog gated nothing (identity release is decided by
  // the allowlist this RPC writes), it dismissed the popup and lost the click, and the
  // fix for that released the identity while the dialog was still unanswered.
  const handleConnect = async () => {
    if (!domain) return;
    setConnectFailed(false);
    try {
      await rpc('connectDomain', { domain });
    } catch {
      // try/finally with no catch made a failed connect an unhandled rejection:
      // the card re-read state, found the site still not connected, and offered
      // Connect again with nothing said. The globe's twin was given this in
      // d18d127; this one was missed.
      setConnectFailed(true);
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
    setConnectFailed(false);
    try {
      await rpc('addDismissedDomain', { domain, permanent });
      window.close();
    } catch {
      // Closing in a `finally` made a failed dismissal indistinguishable from a
      // successful one — the popup vanished either way, and the site re-prompted
      // a user who had said Never. Staying open is the only way they can tell,
      // and the only way they can try again.
      setConnectFailed(true);
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
            {connectFailed && (
              <div className={styles.actionError} role="alert">{t('home.actionFailed')}</div>
            )}
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
        <>
          {connectFailed && (
            <div className={styles.actionError} role="alert">{t('home.actionFailed')}</div>
          )}
          <SiteControls
            identityEnabled={identityEnabled}
            isNip46={isNip46}
            onIdentityToggle={handleIdentityToggle}
            onManagePermissions={() => onManagePermissions(domain!)}
            onRecentActivity={() => onViewAllActivity(domain)}
          />
        </>
      )}

      {/* Account — profile, mutes, and relays that follow the identity, grouped
          into one card so they read as a single list. */}
      {active && (
        <div className={styles.accountSection}>
          <SectionLabel>{t('home.account')}</SectionLabel>
          <Card className={styles.accountCard}>
            {canEditProfile && <ProfileRow onEdit={onEditProfile} />}
            <MutesRow onOpen={onManageFilters} />
            <RelaysRow onOpen={onOpenRelays} />
            {/* Last in the list: the everyday rows people came for come first, and
                post-quantum setup is a once-per-identity errand. */}
            <PqcCard onOpen={onOpenPqc} />
          </Card>
        </div>
      )}
    </>
  );
}
