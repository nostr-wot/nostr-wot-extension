import NsecExportPanel from './NsecExportPanel';
import SeedExportPanel from './SeedExportPanel';
import ChangePasswordPanel from './ChangePasswordPanel';
import { useState, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import Button, { ButtonSecondary } from '@components/Button';
import Input from '@components/Input';
import Modal from '@components/Modal';
import useVaultUnlock from '@hooks/useVaultUnlock.ts';
import { isVaultOpen } from '@domain/vault/vaultAutoUnlock.ts';
import { useVault } from '@context/VaultContext';
import EncryptedBackupForm from '@components/EncryptedBackupForm';
import FormError from '@components/FormError';
import { SectionLabel } from '@components/SectionLabel';
import Container from '@components/Container';

interface KeyActionModalProps {
  action: string;
  onClose: () => void;
}

export default function KeyActionModal({ action, onClose }: KeyActionModalProps) {
  const vault = useVault();
  const [needsUnlock, setNeedsUnlock] = useState<boolean>(false);

  const titles: Record<string, string> = { nsec: t('key.exportTitle'), ncryptsec: t('key.exportEncTitle'), seed: t('key.exportSeedTitle'), changePassword: t('key.changePasswordTitle') };

  const {
    password: unlockPw,
    setPassword: setUnlockPw,
    error: unlockError,
    unlock: handleUnlock,
  } = useVaultUnlock({
    onSuccess: () => { setNeedsUnlock(false); void vault.checkState(); },
    messages: {
      wrongPassword: t('key.wrongPassword'),
      unlockFailed: t('key.failedUnlock'),
    },
  });

  useEffect(() => {
    void (async () => {
      try {
        if (await isVaultOpen(rpc)) { setNeedsUnlock(false); void vault.checkState?.(); return; }
        setNeedsUnlock(true);
      } catch { /* ignore */ }
    })();
  }, []);

  const handleClose = onClose;

  return (
    /* Secret material is on screen here, so this deliberately does NOT dismiss
       on the backdrop: the hand-rolled shell this replaced dismissed on `click`,
       so selecting an nsec and releasing outside the card closed the dialog and
       wiped the value mid-read. */
    <Modal
      title={titles[action] || t('key.keyAction')}
      onClose={handleClose}
      dismissOnBackdrop={false}
      maxWidth={340}
    >
      <>
        {needsUnlock ? (
          <Container gap={5}>
            <SectionLabel inline>{t('key.unlockToContinue')}</SectionLabel>
            <Input
              type="password"
              showToggle
              placeholder={t('key.vaultPassword')}
              value={unlockPw}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setUnlockPw(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleUnlock()}
            />
            <FormError>{unlockError}</FormError>
            <Container variant="row" gap={4} className="justify-end mt-2">
              <ButtonSecondary small onClick={handleClose}>{t('common.cancel')}</ButtonSecondary>
              <Button small onClick={handleUnlock}>{t('common.unlock')}</Button>
            </Container>
          </Container>
        ) : action === 'nsec' ? (
          <NsecExportPanel onClose={handleClose} />
        ) : action === 'ncryptsec' ? (
          <EncryptedBackupForm rpcMethod="vault_exportNcryptsec" onClose={handleClose} />
        ) : action === 'seed' ? (
          <SeedExportPanel onClose={handleClose} />
        ) : action === 'changePassword' ? (
          <ChangePasswordPanel onClose={handleClose} />
        ) : null}
      </>
    </Modal>
  );
}
