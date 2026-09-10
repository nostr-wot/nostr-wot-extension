import RejectionNotice from '@screens/Approval/RejectionNotice';
import { useState, useEffect, useCallback, useMemo } from 'react';
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
import Splash from '@components/Splash';
import TopBar from '@screens/TopBar/TopBar';
import Home from '@screens/Home/Home';
import { NavigationProvider, type HomeNavigation } from '@context/NavigationContext';
import MenuOverlay from '@screens/Menu/MenuOverlay';
import FiltersOverlay from '@screens/Filters/FiltersOverlay';
import ActivityOverlay from '@screens/Activity/ActivityOverlay';
import ApprovalOverlay from '@screens/Approval/ApprovalOverlay';
import WizardOverlay from '@screens/Wizard/WizardOverlay';
import EditProfileOverlay from '@screens/EditProfile/EditProfileOverlay';
import PermissionsSection from '@screens/Settings/PermissionsSection';
import OverlayPanel from '@components/OverlayPanel';
import Container from '@components/Container';
import UnlockModal from '@screens/Vault/UnlockModal';
import { t } from '@services/i18n/i18n.ts';
import { type PendingRequest } from '@domain/signing/types.ts';

type OverlayType = 'menu' | 'filters' | 'activity' | 'wizard' | 'editProfile' | 'permissions' | null;

function PopupInner() {
  const [splashVisible, setSplashVisible] = useState<boolean>(true);
  const [unlockVisible, setUnlockVisible] = useState<boolean>(false);
  const [unlockWaiters, setUnlockWaiters] = useState<PendingRequest[]>([]);
  const [activeOverlay, setActiveOverlay] = useState<OverlayType>(null);
  const [menuSection, setMenuSection] = useState<string | null>(null);
  const [activityDomain, setActivityDomain] = useState<string | null>(null);
  const [permsDomain, setPermsDomain] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const account = useAccount();
  const vault = useVault();

  // Capture active tab screenshot for backdrop.
  //
  // Deferred past first paint: it is decoration, and it competes with the reads
  // the popup actually needs to become usable. It also depends on `activeTab`,
  // which the browser grants when the USER opens the extension and not when the
  // background opens it for an incoming request — so on precisely those popups
  // this fails, and that is expected rather than a permission worth adding.
  useEffect(() => {
    const id = setTimeout(() => {
      browser.tabs.captureVisibleTab({ format: 'jpeg', quality: 20 })
        .then((dataUrl: string) => setScreenshot(dataUrl))
        .catch(() => {}); // chrome:// page, or no activeTab grant — just skip
    }, 0);
    return () => clearTimeout(id);
  }, []);

  // Stable identity. Passed inline, this was a new function on every render,
  // and ApprovalOverlay's refresh depended on it — see the comment there.
  const handleRequestUnlock = useCallback(() => setUnlockVisible(true), []);

  // Dismiss splash after init
  useEffect(() => {
    const timer = setTimeout(() => setSplashVisible(false), 600);
    return () => clearTimeout(timer);
  }, []);

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

  // Stable identity, same reason as `handleRequestUnlock` above: the setters
  // this closes over are themselves stable, so an empty dep array is honest,
  // and it keeps every row under Home from re-rendering on every PopupInner
  // render (the splash timer, the screenshot capture, ...) just because a new
  // navigation object was handed down.
  const navigation = useMemo<HomeNavigation>(() => ({
    viewAllActivity: (d) => { setActivityDomain(d || null); setActiveOverlay('activity'); },
    managePermissions: (domain) => { setPermsDomain(domain); setActiveOverlay('permissions'); },
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
      <TopoBg className="relative z-1 bg-[rgba(255,255,255,0.92)] border border-[rgba(99,102,241,0.15)] rounded-xl h-[calc(600px-16px)] p-8 flex flex-col overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
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

        <MenuOverlay
          visible={activeOverlay === 'menu'}
          onClose={() => { setActiveOverlay(null); setMenuSection(null); }}
          initialSection={menuSection}
        />

        <FiltersOverlay
          visible={activeOverlay === 'filters'}
          onClose={() => setActiveOverlay(null)}
        />

        <ActivityOverlay
          visible={activeOverlay === 'activity'}
          initialDomain={activityDomain}
          initialPubkey={account.active?.pubkey || ''}
          onClose={() => { setActiveOverlay(null); setActivityDomain(null); }}
        />

        <WizardOverlay
          visible={activeOverlay === 'wizard'}
          canClose={(account.accounts?.length ?? 0) > 0}
          onClose={() => setActiveOverlay(null)}
          onComplete={handleWizardComplete}
        />

        <EditProfileOverlay
          visible={activeOverlay === 'editProfile'}
          onClose={() => setActiveOverlay(null)}
        />

        {activeOverlay === 'permissions' && permsDomain && (
          <OverlayPanel
            title={t('security.permissions')}
            onClose={() => { setActiveOverlay(null); setPermsDomain(null); }}
            onBack={() => { setActiveOverlay(null); setPermsDomain(null); }}
            zIndex={300}
          >
            {/* The domain was captured to open this panel and then dropped, so
                "Manage permissions" from a site's card landed on the all-sites
                list and made the user find the site they had just been looking
                at. PermissionsSection has honoured this prop all along. */}
            <PermissionsSection initialDomain={permsDomain} />
          </OverlayPanel>
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
