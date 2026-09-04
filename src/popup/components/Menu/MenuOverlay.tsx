import React, { useState, useEffect, useRef, ReactNode } from 'react';
import { t, getSupportedLanguages, getLanguage, setLanguage } from '@lib/i18n.js';
import { IconLock, IconShield, IconGlobe, IconKey, IconDownload, IconZap, IconInfo } from '@assets';
import { version as appVersion } from '../../../../package.json';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import Modal from '@components/Modal/Modal';
import Button from '@components/Button/Button';
import MenuSection from './MenuSection';
import LanguagePicker from './LanguagePicker';
import type { Language } from '@models/language.ts';
import PqcSection, { type PqcSectionHandle } from '../Settings/PqcSection';
import PermissionsSection, { type PermissionsSectionHandle } from '../Settings/PermissionsSection';
import SecuritySection from '../Settings/SecuritySection';
import NetworkSection from '../Settings/NetworkSection';
import WalletSection from '../Wallet/WalletSection';
import KeyActionModal from '../Vault/KeyActionModal';
import NavItem from '@components/NavItem/NavItem';
import { useVault } from '@popup/context/VaultContext';
import { useAccount } from '@popup/context/AccountContext';
import { useAnimatedVisible } from '@shared/hooks/useAnimatedVisible.ts';
import styles from './MenuOverlay.module.css';
import IconButton from '@components/IconButton/IconButton';

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
  const [navStack, setNavStack] = useState<string[]>([]);
  const [keyAction, setKeyAction] = useState<string | null>(null); // 'nsec' | 'ncryptsec' | 'changePassword'
  const [langModalOpen, setLangModalOpen] = useState<boolean>(false);
  const [permDetailDomain, setPermDetailDomain] = useState<string | null>(null);
  const pqcSectionRef = useRef<PqcSectionHandle>(null);
  const permsSectionRef = useRef<PermissionsSectionHandle>(null);
  const vault = useVault();
  const { isReadOnly, isNip46, active } = useAccount();
  const { shouldRender, animating } = useAnimatedVisible(visible);
  const languages: Language[] = getSupportedLanguages();

  useEffect(() => {
    if (visible && initialSection) {
      setNavStack([initialSection]);
    } else if (!visible) {
      setNavStack([]);
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
  ];

  const sectionTitles: Record<string, string> = {
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

  const openLangPicker = () => setLangModalOpen(true);




  const currentLang = languages.find((l: Language) => l.code === getLanguage()) || languages[0];

  const renderSection = (): ReactNode => {
    switch (currentSection) {
      case 'security':
        return (
          <MenuSection>
            <SecuritySection
              onChangePassword={() => setKeyAction('changePassword')}
            />
            {!isReadOnly && active?.type !== 'nip46' && (
              <>
                <NavItem
                  icon={<IconKey />}
                  label={t('key.exportNsec')}
                  desc={t('key.exportNsecDesc')}
                  onClick={() => setKeyAction('nsec')}
                />
                <NavItem
                  icon={<IconLock />}
                  label={t('key.exportNcryptsec')}
                  desc={t('key.exportNcryptsecDesc')}
                  onClick={() => setKeyAction('ncryptsec')}
                />
                {vault.isGenerated && (
                  <NavItem
                    icon={<IconDownload />}
                    label={t('key.exportSeed')}
                    desc={t('key.exportSeedDesc')}
                    onClick={() => setKeyAction('seed')}
                  />
                )}
              </>
            )}
            <NavItem
              icon={<IconKey />}
              label={t('pqc.menuLabel')}
              desc={t('pqc.menuDesc')}
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
          size={36}
          title={t('pqc.howTitle')}
          aria-label={t('pqc.howTitle')}
          onClick={() => pqcSectionRef.current?.openHowItWorks()}
        >
          <IconInfo size={16} />
        </IconButton>
      ) : undefined}
    >
      <div className={styles.menuContent}>
        <div key={currentSection || '_root'} className={styles.sectionContent}>
          {!currentSection ? (
            <div className={styles.items}>
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
                  <NavItem
                    key={item.id}
                    icon={item.icon}
                    label={item.label}
                    desc={item.desc}
                    onClick={() => handleMenuItem(item.id)}
                  />
                );
              })}
            </div>
          ) : (
            renderSection()
          )}
        </div>

        <div className={styles.menuFooter}>
          {!currentSection && (
            <button className={styles.langRow} onClick={openLangPicker}>
              <span className={styles.langFlag}>{currentLang.flag}</span>
              <span className={styles.langLabel}>{currentLang.native}</span>
              <svg className={styles.langChevron} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
          <div className={styles.aboutFooter}>
            <img src="/icons/icon-base.svg" className={styles.aboutLogo} alt="" />
            <span className={styles.aboutName}>Nostr WoT Extension</span>
            <span className={styles.aboutVersion}>v{appVersion}</span>
          </div>
        </div>
      </div>

      {langModalOpen && <LanguagePicker onClose={() => setLangModalOpen(false)} />}

      {keyAction && (
        <KeyActionModal
          action={keyAction}
          onClose={() => setKeyAction(null)}
        />
      )}
    </OverlayPanel>
  );
}
