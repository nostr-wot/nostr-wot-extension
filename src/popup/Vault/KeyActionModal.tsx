import React, { useState, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { IconWarning } from '@assets';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import Modal from '@components/Modal/Modal';
import useVaultUnlock from '@hooks/useVaultUnlock.ts';
import useCopy from '@hooks/useCopy.ts';
import useTimedReveal from '@hooks/useTimedReveal.ts';
import { isVaultOpen } from '@shared/vaultAutoUnlock.ts';
import { downloadFile } from '@shared/downloadFile.ts';
import { encryptBackup } from '@lib/crypto/keyBackup.ts';
import { useVault } from '@popup/context/VaultContext';
import styles from './KeyActionModal.module.css';
import SeedWord from '@components/SeedWord/SeedWord';
import EncryptedBackupForm from '@components/EncryptedBackupForm/EncryptedBackupForm';
import PasswordPairFields from '@components/PasswordPairFields/PasswordPairFields';
import usePasswordPair from '@hooks/usePasswordPair.ts';
import FormError from '@components/FormError/FormError';

interface KeyActionModalProps {
  action: string;
  onClose: () => void;
}

export default function KeyActionModal({ action, onClose }: KeyActionModalProps) {
  const vault = useVault();
  const [needsUnlock, setNeedsUnlock] = useState<boolean>(false);

  /* One per copyable secret, so each button reports on its own write.
     These three are why useCopy exists: they are the values a reader cannot
     check by eye, so a clipboard the browser refused looked exactly like a
     successful copy. */
  const nsecCopy = useCopy();
  const seedCopy = useCopy();

  // nsec state
  // 30s for the nsec, 60s for the seed phrase — the two timings this screen
  // has always used, now one machine instead of two hand-written copies.
  const nsec = useTimedReveal<string>('', 30_000);

  // seed state
  const seed = useTimedReveal<string[]>([], 60_000);
  const [seedEncMode, setSeedEncMode] = useState<boolean>(false);
  const seedEncPair = usePasswordPair();
  const [seedEncError, setSeedEncError] = useState<string>('');
  const [seedEncrypting, setSeedEncrypting] = useState<boolean>(false);

  // change password state — cpCurrent is not part of the pair, and stays its own field
  const [cpCurrent, setCpCurrent] = useState<string>('');
  const cpPair = usePasswordPair();
  const [cpError, setCpError] = useState<string>('');
  const [cpSuccess, setCpSuccess] = useState<boolean>(false);

  const titles: Record<string, string> = { nsec: t('key.exportTitle'), ncryptsec: t('key.exportEncTitle'), seed: t('key.exportSeedTitle'), changePassword: t('key.changePasswordTitle') };

  const {
    password: unlockPw,
    setPassword: setUnlockPw,
    error: unlockError,
    unlock: handleUnlock,
  } = useVaultUnlock({
    onSuccess: () => { setNeedsUnlock(false); vault.checkState(); },
    messages: {
      wrongPassword: t('key.wrongPassword'),
      unlockFailed: t('key.failedUnlock'),
    },
  });

  useEffect(() => {
    (async () => {
      try {
        if (await isVaultOpen(rpc)) { setNeedsUnlock(false); vault.checkState?.(); return; }
        setNeedsUnlock(true);
      } catch { /* ignore */ }
    })();
  }, []);

  /**
   * Closing wipes what is on screen.
   *
   * This used to be a nine-setter list, which is the shape where a newly added
   * secret field is quietly left out. The two reveals clear themselves — and
   * cancel their auto-hide timers — through the hook; the rest is the seed's
   * encrypt form, which holds a password rather than a key.
   *
   * The ncryptsec export is not listed because it is mounted only while that
   * action is selected, so unmounting it IS its reset — the same reason
   * AddRuleModal has no reset either.
   */
  const handleClose = () => {
    nsec.clear();
    seed.clear();
    setSeedEncMode(false);
    seedEncPair.reset();
    setSeedEncError('');
    onClose();
  };

  // --- nsec ---
  const revealNsec = async () => {
    try {
      const value = await rpc<string>('vault_exportNsec');
      if (value) nsec.reveal(value);
    } catch { /* ignore */ }
  };

  // --- seed ---
  const revealSeed = async () => {
    try {
      const result = await rpc<{ mnemonic: string }>('vault_exportSeed');
      if (result?.mnemonic) seed.reveal(result.mnemonic.split(' '));
    } catch { /* ignore */ }
  };

  const downloadSeedPlain = () => {
    downloadFile(seed.value.join(' '), 'nostr-seed-phrase.txt');
  };

  const downloadSeedEncrypted = async () => {
    setSeedEncError('');
    if (!seedEncPair.ready) return;
    setSeedEncrypting(true);
    try {
      // One implementation, in lib/crypto/keyBackup.ts, where a round-trip test
      // proves the file can be read back. This was inline here — so nothing ever
      // verified that the last copy of someone's seed phrase was decryptable.
      const payload = await encryptBackup(seed.value.join(' '), seedEncPair.password);
      downloadFile(payload, 'nostr-seed-phrase-encrypted.json');
      setSeedEncMode(false);
      seedEncPair.reset();
    } catch {
      setSeedEncError(t('key.failedExport'));
    }
    setSeedEncrypting(false);
  };

  // --- change password ---
  const handleChangePassword = async () => {
    setCpError('');
    if (!cpCurrent) { setCpError(t('key.enterCurrentPassword')); return; }
    if (!cpPair.ready) return;
    try {
      const result = await rpc<{ success?: boolean; error?: string }>('vault_changePassword', { currentPassword: cpCurrent, newPassword: cpPair.password });
      if (result?.success) {
        setCpSuccess(true);
        setTimeout(handleClose, 1500);
      } else {
        setCpError(result?.error || t('key.failedChangePassword'));
      }
    } catch {
      setCpError(t('key.failedChangePassword'));
    }
  };

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
          <div className={styles.section}>
            <label>{t('key.unlockToContinue')}</label>
            <Input
              type="password"
              showToggle
              placeholder={t('key.vaultPassword')}
              value={unlockPw}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setUnlockPw(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleUnlock()}
            />
            <FormError>{unlockError}</FormError>
            <div className={styles.actions}>
              <Button variant="secondary" small onClick={handleClose}>{t('common.cancel')}</Button>
              <Button small onClick={handleUnlock}>{t('common.unlock')}</Button>
            </div>
          </div>
        ) : action === 'nsec' ? (
          <div className={styles.section}>
            {!nsec.revealed ? (
              <>
                <div className={styles.warning}>
                  <IconWarning />
                  <span>{t('key.nsecWarning')}</span>
                </div>
                <div className={styles.actions}>
                  <Button variant="secondary" small onClick={handleClose}>{t('common.cancel')}</Button>
                  <Button variant="danger" small onClick={revealNsec}>{t('key.revealKey')}</Button>
                </div>
              </>
            ) : (
              <>
                {/* Reveal is a toggle, and it was a div with an onClick — so
                    the only way to see your own nsec required a mouse.
                    aria-pressed reports whether it is currently revealed. */}
                <button
                  type="button"
                  className={`${styles.keyDisplay} ${nsec.blurred ? styles.blurred : ''}`}
                  onClick={nsec.toggleBlur}
                  aria-pressed={!nsec.blurred}
                >
                  {nsec.value}
                </button>
                <div className={styles.hint}>{`${t(nsec.blurred ? 'key.clickToReveal' : 'key.clickToBlur')} \u00b7 ${t('key.autoHideHint')}`}</div>
                <div className={styles.actions}>
                  <Button variant="secondary" small onClick={handleClose}>{t('common.close')}</Button>
                  <Button small onClick={() => nsecCopy.copy(nsec.value)}>
                    {nsecCopy.copied ? t('common.copied') : t('common.copy')}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : action === 'ncryptsec' ? (
          <EncryptedBackupForm rpcMethod="vault_exportNcryptsec" onClose={handleClose} />
        ) : action === 'seed' ? (
          <div className={styles.section}>
            {!seed.revealed ? (
              <>
                <div className={styles.warning}>
                  <IconWarning />
                  <span>{t('key.seedWarning')}</span>
                </div>
                <div className={styles.actions}>
                  <Button variant="secondary" small onClick={handleClose}>{t('common.cancel')}</Button>
                  <Button variant="danger" small onClick={revealSeed}>{t('key.revealKey')}</Button>
                </div>
              </>
            ) : (
              <>
                <button type="button" className={styles.seedGridWrap} onClick={seed.toggleBlur} aria-pressed={!seed.blurred}>
                  <div className={`${styles.seedGrid} ${seed.blurred ? styles.blurred : ''}`}>
                    {seed.value.map((word, i) => (
                      <SeedWord key={i} index={i + 1} word={word} />
                    ))}
                  </div>
                </button>
                <div className={styles.hint}>{`${t(seed.blurred ? 'key.clickToReveal' : 'key.clickToBlur')} \u00b7 ${t('key.seedAutoHideHint')}`}</div>
                {seedEncMode ? (
                  <>
                    <PasswordPairFields
                      pair={seedEncPair}
                      passwordPlaceholder={t('key.seedDownloadPassword')}
                      confirmPlaceholder={t('key.seedDownloadConfirm')}
                      onSubmit={downloadSeedEncrypted}
                      disabled={seedEncrypting}
                    />
                    <FormError>{seedEncError}</FormError>
                    <div className={styles.actions}>
                      <Button variant="secondary" small onClick={() => { setSeedEncMode(false); seedEncPair.reset(); setSeedEncError(''); }}>{t('common.cancel')}</Button>
                      <Button small onClick={downloadSeedEncrypted} disabled={seedEncrypting || !seedEncPair.ready}>
                        {seedEncrypting ? t('key.seedEncrypting') : t('common.download')}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className={styles.seedActions}>
                    <Button variant="secondary" small onClick={handleClose}>{t('common.close')}</Button>
                    <Button variant="secondary" small onClick={() => seedCopy.copy(seed.value.join(' '))}>
                      {seedCopy.copied ? t('common.copied') : t('common.copy')}
                    </Button>
                    <Button variant="secondary" small onClick={downloadSeedPlain}>{t('key.downloadPlain')}</Button>
                    <Button small onClick={() => setSeedEncMode(true)}>{t('key.downloadEncrypted')}</Button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : action === 'changePassword' ? (
          <div className={styles.section}>
            {cpSuccess ? (
              <div className={styles.success}>{t('key.passwordChanged')}</div>
            ) : (
              <>
                <Input
                  type="password"
                  showToggle
                  placeholder={t('key.currentPw')}
                  value={cpCurrent}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCpCurrent(e.target.value)}
                />
                <PasswordPairFields
                  pair={cpPair}
                  passwordPlaceholder={t('key.newPwMinChars')}
                  confirmPlaceholder={t('key.confirmNewPw')}
                  onSubmit={handleChangePassword}
                />
                <FormError>{cpError}</FormError>
                <div className={styles.actions}>
                  <Button variant="secondary" small onClick={handleClose}>{t('common.cancel')}</Button>
                  <Button small onClick={handleChangePassword} disabled={!cpPair.ready}>{t('common.save')}</Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </>
    </Modal>
  );
}
