import AppearanceSection from '@screens/Settings/AppearanceSection';
import IconSettings from '@assets/IconSettings.tsx';
import WotHowItWorks from '@screens/Settings/WotHowItWorks';
import { useState, useEffect, useRef, ReactNode } from 'react';
import { t } from '@services/i18n/i18n.ts';
import IconLock from '@assets/IconLock.tsx';
import IconShield from '@assets/IconShield.tsx';
import IconGlobe from '@assets/IconGlobe.tsx';
import IconKey from '@assets/IconKey.tsx';
import IconDownload from '@assets/IconDownload.tsx';
import IconZap from '@assets/IconZap.tsx';
import IconInfo from '@assets/IconInfo.tsx';
import { version as appVersion } from '../../../package.json';
import OverlayPanel from '@components/OverlayPanel';
import MenuSection from './MenuSection';
import PqcSection, { type PqcSectionHandle } from '@screens/Settings/PqcSection';
import PermissionsSection, { type PermissionsSectionHandle } from '@screens/Settings/PermissionsSection';
import SecuritySection from '@screens/Settings/SecuritySection';
import NetworkSection from '@screens/Settings/NetworkSection';
import WotSection from '@screens/Settings/WotSection';
import WalletSection from '@screens/Wallet/WalletSection';
import KeyActionModal from '@screens/Vault/KeyActionModal';
import ListRow from '@components/ListRow';
import { useVault } from '@context/VaultContext';
import { useAccount } from '@context/AccountContext';
import { useAnimatedVisible } from '@hooks/useAnimatedVisible.ts';
import IconButton from '@components/IconButton';
import Container from '@components/Container';
import Text from '@components/Text';

interface MenuOverlayProps {
  visible: boolean;
  onClose: () => void;
  initialSection?: string | null;
}

interface MenuItem {
  id: string;
  label: string;
  desc?: string;
  icon: ReactNode;
}

export default function MenuOverlay({ visible, onClose, initialSection }: MenuOverlayProps) {
  const [wotInfoOpen, setWotInfoOpen] = useState(false);
  const [navStack, setNavStack] = useState<string[]>([]);
  const [keyAction, setKeyAction] = useState<string | null>(null); // 'nsec' | 'ncryptsec' | 'changePassword'
  const [permDetailDomain, setPermDetailDomain] = useState<string | null>(null);
  const pqcSectionRef = useRef<PqcSectionHandle>(null);
  const permsSectionRef = useRef<PermissionsSectionHandle>(null);
  const vault = useVault();
  const { isReadOnly, isNip46, active } = useAccount();
  const { shouldRender, animating } = useAnimatedVisible(visible);

  useEffect(() => {
    if (visible && initialSection) {
      setNavStack([initialSection]);
    } else if (!visible) {
      setNavStack([]);
      setWotInfoOpen(false);
    }
  }, [visible, initialSection]);

  const menuItems: MenuItem[] = [
    {
      id: 'security',
      label: t('settings.security'),
      desc: t('settings.securityDesc'),
      icon: <IconLock />,
    },
    {
      id: 'site-permissions',
      label: t('security.permissions'),
      desc: t('security.permissionsDesc'),
      icon: <IconShield />,
    },
    {
      id: 'wallet',
      label: t('wallet.title'),
      // Not `wallet.connectHint`. That reads "Connect a Lightning wallet…",
      // which the row went on saying to people who had already connected one.
      desc: t('menu.walletDesc'),
      icon: <IconZap />,
    },
    {
      id: 'network',
      // "Relays", not "Network". The home screen's row for the same destination
      // has always called it Relays, so the menu was teaching a second name for
      // one thing; and "Network" says nothing about what is inside.
      label: t('network.relays'),
      desc: t('menu.relaysDesc'),
      icon: <IconGlobe />,
    },
    { id: 'experimental-wot', label: t('wot.title'), desc: t('wot.menuDesc'), icon: <IconGlobe /> },
    { id: 'appearance', label: t('appearance.title'), desc: t('appearance.menuDesc'), icon: <IconSettings /> },
  ];

  const sectionTitles: Record<string, string> = {
    'experimental-wot': t('wot.title'),
    appearance: t('appearance.title'),
    security: t('settings.security'),
    network: t('network.relays'),
    wallet: t('wallet.title'),
    'site-permissions': permDetailDomain || t('security.permissions'),
    pqc: t('pqc.menuLabel'),
  };

  if (!shouldRender) return null;

  const currentSection = navStack[navStack.length - 1] || null;
  const title = currentSection ? (sectionTitles[currentSection] || t('settings.title')) : t('settings.title');

  const pushSection = (id: string) => setNavStack((s) => [...s, id]);
  const popSection = () => {
    // Let child sections handle back internally first
    if (currentSection === 'site-permissions' && permsSectionRef.current?.goBack()) return;
    // If we're at the initial deep-linked section, close the entire overlay
    if (initialSection && navStack.length === 1 && navStack[0] === initialSection) {
      handleClose();
      return;
    }
    setNavStack((s) => s.slice(0, -1));
  };
  const handleClose = () => { setNavStack([]); onClose(); };

  const handleMenuItem = (id: string) => {
    pushSection(id);
  };

  const renderSection = (): ReactNode => {
    switch (currentSection) {
      case 'appearance':
        return <AppearanceSection />;
      case 'security':
        return (
          <MenuSection>
            <SecuritySection
              onChangePassword={() => setKeyAction('changePassword')}
            />
            {!isReadOnly && active?.type !== 'nip46' && (
              <>
                <ListRow
                  variant="standalone"
                  leadingChip={false}
                  leading={<IconKey />}
                  title={t('key.exportNsec')}
                  subtitle={t('key.exportNsecDesc')}
                  onClick={() => setKeyAction('nsec')}
                />
                <ListRow
                  variant="standalone"
                  leadingChip={false}
                  leading={<IconLock />}
                  title={t('key.exportNcryptsec')}
                  subtitle={t('key.exportNcryptsecDesc')}
                  onClick={() => setKeyAction('ncryptsec')}
                />
                {vault.isGenerated && (
                  <ListRow
                    variant="standalone"
                    leadingChip={false}
                    leading={<IconDownload />}
                    title={t('key.exportSeed')}
                    subtitle={t('key.exportSeedDesc')}
                    onClick={() => setKeyAction('seed')}
                  />
                )}
              </>
            )}
            <ListRow
              variant="standalone"
              leadingChip={false}
              leading={<IconKey />}
              title={t('pqc.menuLabel')}
              subtitle={t('pqc.menuDesc')}
              onClick={() => pushSection('pqc')}
            />
          </MenuSection>
        );
      case 'pqc':
        return (
          <MenuSection>
            <PqcSection ref={pqcSectionRef} />
          </MenuSection>
        );
      case 'site-permissions':
        return <PermissionsSection ref={permsSectionRef} onDetailChange={setPermDetailDomain} />;
      case 'wallet':
        return <WalletSection />;
      case 'experimental-wot':
        return <WotSection />;
      case 'network':
        return <NetworkSection />;
      default:
        return null;
    }
  };

  return (
    <OverlayPanel
      title={title}
      onClose={handleClose}
      onBack={currentSection ? popSection : null}
      animating={animating}
      headerRight={currentSection === 'pqc' ? (
        // The explainer shows itself once; this is how it is reached again afterwards.
        <IconButton
          size="large"
          title={t('pqc.howTitle')}
          aria-label={t('pqc.howTitle')}
          onClick={() => pqcSectionRef.current?.openHowItWorks()}
        >
          <IconInfo size={16} />
        </IconButton>
      ) : currentSection === 'experimental-wot' ? <IconButton size="large" title={t('wot.howTitle')} aria-label={t('wot.howTitle')} onClick={() => setWotInfoOpen(true)}><IconInfo size={16}/></IconButton> : undefined}
    >
      {currentSection === 'experimental-wot' && wotInfoOpen && <WotHowItWorks onClose={() => setWotInfoOpen(false)}/>}
      <Container className="flex-1 min-h-0">
                {/* `backwards`, carried by the registered animation, is load-bearing.
            `both` would keep the final transform: translateX(0) permanently, and
            a non-none transform makes the element a containing block for fixed
            descendants — which is how five dialogs once ended up escaping to
            #root portals to get away from it. The padding/negative-margin pair
            buys back the room card shadows need inside a one-axis scroller. */}
        <div key={currentSection || '_root'} className="animate-section-slide-in overflow-y-auto px-2 -mx-2">
          {!currentSection ? (
            <Container gap={2} className="flex-1 py-2 px-1">
              {menuItems.map((item) => {
                // NOTE: there is no 'nip46' item to filter. The row was removed
                // without being re-homed, and this line outlived it — it cost one
                // audit a false lead before anyone noticed. The capability it
                // guarded is genuinely missing, not merely hidden:
                // `nip46_revokeSession` is registered in the background
                // (publish-handlers.ts) and has no caller anywhere, so a user on a
                // remote signer has no way to revoke their bunker session. That
                // needs a section, which is more than a label change; tracked in
                // docs/ui-ux-audit.md §3 move 4.
                if (item.id === 'wallet' && (isReadOnly || isNip46 || vault.locked)) return null;
                return (
                  <ListRow
                    variant="standalone"
                    leadingChip={false}
                    key={item.id}
                    leading={item.icon}
                    title={item.label}
                    subtitle={item.desc}
                    onClick={() => handleMenuItem(item.id)}
                  />
                );
              })}
            </Container>
          ) : (
            renderSection()
          )}
        </div>

        <Container className="mt-auto items-center pt-6 shrink-0">
          <Container variant="row" gap={4} className="justify-center py-4 opacity-50">
            <img src="/icons/icon-base.svg" className="w-8 h-8" alt="" />
            <Text variant="secondary" as="span" className="text-xs font-semibold">Nostr WoT Extension</Text>
            <Text variant="muted" as="span">v{appVersion}</Text>
          </Container>
        </Container>
      </Container>

      {keyAction && (
        <KeyActionModal
          action={keyAction}
          onClose={() => setKeyAction(null)}
        />
      )}
    </OverlayPanel>
  );
}
