import React, { useState, useEffect, useCallback, useRef } from 'react';
import browser from '@lib/browser.ts';
import { rpc } from '@services/rpc.ts';
import { resolveActiveTabDomain } from '@domain/site/activeTabDomain.ts';
import { formatSats } from '@utils/format/number.ts';
import { resolveSiteState } from '@domain/site/siteState.ts';
import { t } from '@lib/i18n.js';
import { useAccount } from '@context/AccountContext';
import { useVault } from '@context/VaultContext';
import useSiteState from '@hooks/useSiteState.ts';
import type { Account } from '@domain/accounts/account.ts';
import useWalletBanner from '@hooks/useWalletBanner.ts';
import usePendingCount from '@hooks/usePendingCount.ts';
import { useNavigate } from '@context/NavigationContext';
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
import type { PendingRequest } from '@lib/types.ts';
import LinkButton from '@components/LinkButton/LinkButton';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

interface HomeProps {
  menuOpen?: boolean;
}

export default function Home({ menuOpen }: HomeProps) {
  const { active, cachedProfile, isReadOnly, isNip46 } = useAccount();
  const { locked } = useVault();
  const navigate = useNavigate();

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
      <Container className="flex-1 justify-center">
        <Card className="mb-0">
          <EmptyState
            icon={
              <IconGlobe size={32} strokeWidth="1.5" />
            }
            text={t('home.navigateToConnect')}
            hint={t('home.siteControlsHint')}
          />
        </Card>
      </Container>
    );
  }

  if (siteState === null) {
    return (
      <Container className="flex-1 justify-center">
        <Card className="mb-0">
          <EmptyState
            icon={
              <IconGlobe size={32} strokeWidth="1.5" />
            }
            text={t('common.loading')}
          />
        </Card>
      </Container>
    );
  }

  if (siteState === 'notConnected') {
    return (
      <Container className="flex-1 justify-center">
        <Card className="mb-0">
          <EmptyState
            icon={
              <IconGlobe size={32} strokeWidth="1.5" />
            }
            text={domain!}
            hint={t('home.siteNotConnected')}
          >
            {connectFailed && (
              <div className="py-3 px-6 text-sm text-error text-center" role="alert">{t('home.actionFailed')}</div>
            )}
            <Container variant="row" gap={4} className="justify-center">
              <Button small onClick={handleConnect}>{t('home.connectThisSite')}</Button>
              <Button small variant="secondary" onClick={() => handleDismiss(false)}>{t('home.notNow')}</Button>
              <Button small variant="secondary" onClick={() => handleDismiss(true)}>{t('home.never')}</Button>
            </Container>
          </EmptyState>
        </Card>
      </Container>
    );
  }

  return (
    <>
      {pendingCount > 0 && (
        <Card className="flex items-center py-5 px-7 bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.2)] cursor-default">
          <Container variant="row" gap={4}>
            <span className="bg-warning-bright text-on-brand text-xs font-semibold min-w-10 h-10 rounded-panel flex items-center justify-center px-3">{pendingCount}</span>
            <Text as="span">{t('unlock.pendingCount', { count: pendingCount })}</Text>
          </Container>
        </Card>
      )}
      {/* Wallet — on top: balance card when a wallet exists, else the setup prompt */}
      {walletState && typeof walletState === 'object' && (
        <Card className="flex items-center justify-between gap-5 py-6 px-7 cursor-pointer transition-colors hover:bg-brand-tint-hover" onClick={navigate.openWallet}>
          <Container variant="row" gap={5} className="min-w-0">
            <IconZap size={14} className="text-brand shrink-0" />
            <Container gap="px">
              <strong className="text-xl font-bold text-heading">{formatSats(walletState.balance)}</strong>
              <Text variant="muted" as="span" className="uppercase tracking-[0.3px] font-semibold">{t('wallet.balance')}</Text>
            </Container>
          </Container>
          <IconChevronRight size={16} />
        </Card>
      )}

      {showWalletBanner && (
        <Card className="flex items-center justify-between gap-5 py-6 px-7">
          <Container variant="row" gap={5} className="items-start flex-1 min-w-0">
            <IconZap size={14} className="text-brand shrink-0 mt-1" />
            <Container gap={1}>
              <strong className="text-md font-semibold text-heading">{t('wallet.setupBanner')}</strong>
              <Text variant="secondary" as="span" className="text-xs">{t('wallet.setupBannerHint')}</Text>
            </Container>
          </Container>
          <Container gap={2} className="items-center shrink-0">
            <Button small onClick={navigate.openWallet}>{t('home.setupProfileButton')}</Button>
            <LinkButton onClick={handleDismissWallet}>{t('home.skip')}</LinkButton>
          </Container>
        </Card>
      )}

      {/* Identity access for the current site */}
      {siteState === 'error' ? (
        <Card className="mb-0">
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
            <div className="py-3 px-6 text-sm text-error text-center" role="alert">{t('home.actionFailed')}</div>
          )}
          <SiteControls
            identityEnabled={identityEnabled}
            isNip46={isNip46}
            onIdentityToggle={handleIdentityToggle}
            domain={domain}
          />
        </>
      )}

      {/* Account — profile, mutes, and relays that follow the identity, grouped
          into one card so they read as a single list. */}
      {active && (
        <div className="[&_label]:ml-1 [&_label]:mb-3 mt-7">
          <SectionLabel>{t('home.account')}</SectionLabel>
          <Card className="p-0 overflow-hidden">
            {canEditProfile && <ProfileRow />}
            <MutesRow />
            <RelaysRow />
            {/* Last in the list: the everyday rows people came for come first, and
                post-quantum setup is a once-per-identity errand. */}
            <PqcCard />
          </Card>
        </div>
      )}
    </>
  );
}
