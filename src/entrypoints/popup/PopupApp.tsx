import PaymentSuccessNotice from '@screens/Wallet/PaymentSuccessNotice';
import RejectionNotice from '@screens/Approval/RejectionNotice';
import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import browser from '@lib/browser.ts';
import { rpcNotify } from '@services/rpc.ts';
import '@styles/tailwind.css';
import { AccountProvider, useAccount } from '@context/AccountContext';
import { VaultProvider, useVault } from '@context/VaultContext';
import { PermissionsProvider } from '@context/PermissionsContext';
import { WalletProvider } from '@context/WalletContext';
import { RelaysProvider } from '@context/RelaysContext';
import { PqcProvider } from '@context/PqcContext';
import TopoBg from '@components/TopoBg';
import Splash, { SPLASH_FADE_MS } from '@components/Splash';
import TopBar from '@screens/TopBar/TopBar';
import Home from '@screens/Home/Home';
import { NavigationProvider, type HomeNavigation } from '@context/NavigationContext';
import ApprovalOverlay from '@screens/Approval/ApprovalOverlay';
import OverlayPanel from '@components/OverlayPanel';
import { useLatch } from '@hooks/useLatch.ts';
import Container from '@components/Container';
import UnlockModal from '@screens/Vault/UnlockModal';
import { type PendingRequest } from '@domain/signing/types.ts';

// Not on screen when the popup opens, so not in the code the browser must load
// and evaluate before it shows the popup at all. ApprovalOverlay and
// UnlockModal stay eager: either can be the first thing a popup shows.
const MenuOverlay = lazy(() => import('@screens/Menu/MenuOverlay'));
const FiltersOverlay = lazy(() => import('@screens/Filters/FiltersOverlay'));
const ActivityOverlay = lazy(() => import('@screens/Activity/ActivityOverlay'));
const WizardOverlay = lazy(() => import('@screens/Wizard/WizardOverlay'));
const EditProfileOverlay = lazy(() => import('@screens/EditProfile/EditProfileOverlay'));
const RulesScreen = lazy(() => import('@screens/Settings/RulesScreen'));

// The splash stays at least this long, so a fast open does not flash the logo,
// and at most SPLASH_MAX_MS, so a slow account read cannot hold the popup.
const SPLASH_MIN_MS = 200;
const SPLASH_MAX_MS = 600;

type OverlayType = 'menu' | 'filters' | 'activity' | 'wizard' | 'editProfile' | 'permissions' | null;

function PopupInner() {
  const [splashMinPassed, setSplashMinPassed] = useState<boolean>(false);
  const [splashMaxPassed, setSplashMaxPassed] = useState<boolean>(false);
  const [unlockVisible, setUnlockVisible] = useState<boolean>(false);
  const [unlockWaiters, setUnlockWaiters] = useState<PendingRequest[]>([]);
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>(null);
  const [menuSection, setMenuSection] = useState<string | null>(null);
  const [activityDomain, setActivityDomain] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const account = useAccount();
  const vault = useVault();

  // Ends when the account list is read (one storage.local read, no background),
  // not after a fixed delay. See SPLASH_MIN_MS / SPLASH_MAX_MS.
  const splashVisible = !splashMaxPassed && !(splashMinPassed && account.accounts !== null);
  useEffect(() => {
    const min = setTimeout(() => setSplashMinPassed(true), SPLASH_MIN_MS);
    const max = setTimeout(() => setSplashMaxPassed(true), SPLASH_MAX_MS);
    return () => { clearTimeout(min); clearTimeout(max); };
  }, []);

  // Capture active tab screenshot for backdrop.
  //
  // Deferred past first paint: it is decoration, and it competes with the reads
  // the popup actually needs to become usable. It also depends on `activeTab`,
  // which the browser grants when the USER opens the extension and not when the
  // background opens it for an incoming request — so on precisely those popups
  // this fails, and that is expected rather than a permission worth adding.
  //
  // Waits for the splash to finish fading, too: the JPEG encode and the blurred
  // layer it adds used to land during the fade, on top of the splash's own blur.
  useEffect(() => {
    if (splashVisible) return;
    const id = setTimeout(() => {
      browser.tabs.captureVisibleTab({ format: 'jpeg', quality: 20 })
        .then((dataUrl: string) => setScreenshot(dataUrl))
        .catch(() => {}); // chrome:// page, or no activeTab grant — just skip
    }, SPLASH_FADE_MS);
    return () => clearTimeout(id);
  }, [splashVisible]);

  // Stable identity. Passed inline, this was a new function on every render,
  // and ApprovalOverlay's refresh depended on it — see the comment there.
  const handleRequestUnlock = useCallback(() => setUnlockVisible(true), []);

  // Show wizard if no accounts
  useEffect(() => {
    if (account.accounts !== null && account.accounts.length === 0) {
      setActiveOverlay('wizard');
    }
  }, [account.accounts]);

  // Resume wizard if there's persisted mid-flow state (e.g. user closed popup during seed creation)
  useEffect(() => {
    browser.storage.session.get('wizardState')
      .then((data: Record<string, unknown>) => {
        const saved = data.wizardState as { step?: string; ts?: number } | undefined;
        if (saved?.step && saved?.ts && Date.now() - saved.ts < 5 * 60 * 1000) {
          setActiveOverlay('wizard');
        }
      })
      .catch(() => {});
  }, []);

  // Auto-show unlock screen when vault is locked
  const vaultLockScreen = vault.exists && vault.locked && vault.autoLockEnabled;

  useEffect(() => {
    if (vaultLockScreen && (activeOverlay === 'activity' || activeOverlay === 'menu')) setActiveOverlay(null);
  }, [vaultLockScreen, activeOverlay]);

  const handleWizardComplete = () => {
    setActiveOverlay(null);
    account.reload();
    rpcNotify('configUpdated');
  };

  // A lazy overlay renders from the first time it is asked for. See useLatch.
  const menuRequested = useLatch(activeOverlay === 'menu');
  const filtersRequested = useLatch(activeOverlay === 'filters');
  const activityRequested = useLatch(activeOverlay === 'activity');
  const wizardRequested = useLatch(activeOverlay === 'wizard');
  const editProfileRequested = useLatch(activeOverlay === 'editProfile');

  // Stable identity, same reason as `handleRequestUnlock` above: the setters
  // this closes over are themselves stable, so an empty dep array is honest,
  // and it keeps every row under Home from re-rendering on every PopupInner
  // render (the splash timer, the screenshot capture, ...) just because a new
  // navigation object was handed down.
  const navigation = useMemo<HomeNavigation>(() => ({
    viewAllActivity: (d) => { setActivityDomain(d || null); setActiveOverlay('activity'); },
    managePermissions: () => setActiveOverlay('permissions'),
    manageFilters: () => setActiveOverlay('filters'),
    editProfile: () => setActiveOverlay('editProfile'),
    openRelays: () => { setMenuSection('network'); setActiveOverlay('menu'); },
    openPqc: () => { setMenuSection('pqc'); setActiveOverlay('menu'); },
    openWallet: () => { setMenuSection('wallet'); setActiveOverlay('menu'); },
  }), []);

  return (
    <>
      {screenshot && (
        <div
          className="fixed inset-0 w-full h-full z-0 bg-cover bg-center blur-[18px] brightness-95 scale-110"
          style={{ backgroundImage: `url(${screenshot})` }}
        />
      )}
      <TopoBg className="relative z-1 bg-glass-heavy border border-[rgba(99,102,241,0.15)] rounded-xl h-[calc(600px-16px)] p-8 flex flex-col overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
        <Splash visible={splashVisible} />
        <TopBar
          onMenuOpen={() => setActiveOverlay('menu')}
          onAddAccount={() => setActiveOverlay('wizard')}
        />

        <Container gap={2} className="[&>*]:shrink-0 flex-1 overflow-y-auto min-h-0">
          <NavigationProvider value={navigation}>
            <Home menuOpen={activeOverlay === 'menu'} />
          </NavigationProvider>
        </Container>

        <ApprovalOverlay
          onRequestUnlock={handleRequestUnlock}
          onUnlockWaitersChange={setUnlockWaiters}
        />

        <RejectionNotice />
        {!vault.locked && account.active?.id && <PaymentSuccessNotice key={account.active.id} accountId={account.active.id} />}

        {menuRequested && (
          <Suspense fallback={null}>
            <MenuOverlay
              visible={activeOverlay === 'menu'}
              onClose={() => { setActiveOverlay(null); setMenuSection(null); }}
              initialSection={menuSection}
            />
          </Suspense>
        )}

        {filtersRequested && (
          <Suspense fallback={null}>
            <FiltersOverlay
              visible={activeOverlay === 'filters'}
              onClose={() => setActiveOverlay(null)}
            />
          </Suspense>
        )}

        {activityRequested && (
          <Suspense fallback={null}>
            <ActivityOverlay
              visible={activeOverlay === 'activity'}
              initialDomain={activityDomain}
              initialPubkey={account.active?.pubkey || ''}
              onClose={() => { setActiveOverlay(null); setActivityDomain(null); }}
            />
          </Suspense>
        )}

        {wizardRequested && (
          <Suspense fallback={null}>
            <WizardOverlay
              visible={activeOverlay === 'wizard'}
              canClose={(account.accounts?.length ?? 0) > 0}
              onClose={() => setActiveOverlay(null)}
              onComplete={handleWizardComplete}
            />
          </Suspense>
        )}

        {editProfileRequested && (
          <Suspense fallback={null}>
            <EditProfileOverlay
              visible={activeOverlay === 'editProfile'}
              onClose={() => setActiveOverlay(null)}
            />
          </Suspense>
        )}

        {activeOverlay === 'permissions' && (
          <Suspense fallback={null}>
            <OverlayPanel showHeader={false} zIndex={300}>
              <RulesScreen onBack={() => setActiveOverlay(null)} />
            </OverlayPanel>
          </Suspense>
        )}

        <UnlockModal
          visible={vaultLockScreen || unlockVisible}
          fullScreen={vaultLockScreen}
          unlockWaiters={unlockWaiters}
          onUnlocked={() => setUnlockVisible(false)}
          onCancel={vaultLockScreen ? undefined : () => setUnlockVisible(false)}
        />
      </TopoBg>
    </>
  );
}

export default function PopupApp() {
  return (
    <AccountProvider>
      <VaultProvider>
        <PermissionsProvider>
          {/* Wallet/Relays/Pqc nest inside AccountProvider because Wallet and
              Pqc key their refetch on the active account (`useAccount`). */}
          <WalletProvider>
            <RelaysProvider>
              <PqcProvider>
                <PopupInner />
              </PqcProvider>
            </RelaysProvider>
          </WalletProvider>
        </PermissionsProvider>
      </VaultProvider>
    </AccountProvider>
  );
}
