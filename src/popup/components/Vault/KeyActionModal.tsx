import React, { useState, useEffect, ChangeEvent, KeyboardEvent } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { IconWarning } from '@assets';
import Button from '@components/Button/Button';
import Input from '@components/Input/Input';
import Modal from '@components/Modal/Modal';
import useVaultUnlock from '@shared/hooks/useVaultUnlock.ts';
import useCopy from '@shared/hooks/useCopy.ts';
import useTimedReveal from '@shared/hooks/useTimedReveal.ts';
import { isVaultOpen } from '@shared/vaultAutoUnlock.ts';
import { downloadFile } from '@shared/downloadFile.ts';
import { encryptBackup } from '@lib/crypto/keyBackup.ts';
import { useVault } from '@popup/context/VaultContext';
import styles from './KeyActionModal.module.css';
import { validatePasswordPair, MIN_PASSWORD_LENGTH } from '@shared/passwordPair.ts';

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
  const ncCopy = useCopy();
  const seedCopy = useCopy();

  // nsec state
  // 30s for the nsec, 60s for the seed phrase — the two timings this screen
  // has always used, now one machine instead of two hand-written copies.
  const nsec = useTimedReveal<string>('', 30_000);

  // ncryptsec state
  const [ncPassword, setNcPassword] = useState<string>('');
  const [ncConfirm, setNcConfirm] = useState<string>('');
  const [ncValue, setNcValue] = useState<string>('');
  const [ncError, setNcError] = useState<string>('');
  const [ncGenerating, setNcGenerating] = useState<boolean>(false);

  // seed state
  const seed = useTimedReveal<string[]>([], 60_000);
  const [seedEncMode, setSeedEncMode] = useState<boolean>(false);
  const [seedEncPw, setSeedEncPw] = useState<string>('');
  const [seedEncConfirm, setSeedEncConfirm] = useState<string>('');
  const [seedEncError, setSeedEncError] = useState<string>('');
  const [seedEncrypting, setSeedEncrypting] = useState<boolean>(false);

  // change password state
  const [cpCurrent, setCpCurrent] = useState<string>('');
  const [cpNew, setCpNew] = useState<string>('');
  const [cpConfirm, setCpConfirm] = useState<string>('');
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
   * cancel their auto-hide timers — through the hook; the rest is the encrypt
   * form, which holds a password rather than a key.
   */
  const handleClose = () => {
    nsec.clear();
    seed.clear();
    setNcValue('');
    setSeedEncMode(false);
    setSeedEncPw('');
    setSeedEncConfirm('');
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

  // --- ncryptsec ---
  // Derived, not stored: the button's guard and the checklist must agree, and
  // two pieces of state for one question is how they stop agreeing.
  const ncLongEnough = ncPassword.length >= MIN_PASSWORD_LENGTH;
  const ncMatches = ncPassword.length > 0 && ncPassword === ncConfirm;
  const ncReady = ncLongEnough && ncMatches;

  const downloadNcryptsec = () => {
    downloadFile(ncValue, `nostr-key-${Date.now()}.ncryptsec`);
  };

  const generateNcryptsec = async () => {
    setNcError('');
    const ncProblem = validatePasswordPair(ncPassword, ncConfirm);
    if (ncProblem) {
      setNcError(t(ncProblem === 'tooShort' ? 'key.passwordMin8' : 'key.passwordsNoMatch'));
      return;
    }
    setNcGenerating(true);
    try {
      const result = await rpc<string>('vault_exportNcryptsec', { password: ncPassword });
      if (result) setNcValue(result);
      else setNcError(t('key.failedExport'));
    } catch {
      setNcError(t('key.failedExport'));
    }
    setNcGenerating(false);
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
    const seedProblem = validatePasswordPair(seedEncPw, seedEncConfirm);
    if (seedProblem) {
      setSeedEncError(t(seedProblem === 'tooShort' ? 'key.passwordMin8' : 'key.passwordsNoMatch'));
      return;
    }
    setSeedEncrypting(true);
    try {
      // One implementation, in lib/crypto/keyBackup.ts, where a round-trip test
      // proves the file can be read back. This was inline here — so nothing ever
      // verified that the last copy of someone's seed phrase was decryptable.
      const payload = await encryptBackup(seed.value.join(' '), seedEncPw);
      downloadFile(payload, 'nostr-seed-phrase-encrypted.json');
      setSeedEncMode(false);
      setSeedEncPw('');
      setSeedEncConfirm('');
    } catch {
      setSeedEncError(t('key.failedExport'));
    }
    setSeedEncrypting(false);
  };

  // --- change password ---
  const handleChangePassword = async () => {
    setCpError('');
    if (!cpCurrent) { setCpError(t('key.enterCurrentPassword')); return; }
    const cpProblem = validatePasswordPair(cpNew, cpConfirm);
    if (cpProblem) {
      setCpError(t(cpProblem === 'tooShort' ? 'key.newPasswordMin8' : 'key.passwordsNoMatch'));
      return;
    }
    try {
      const result = await rpc<{ success?: boolean; error?: string }>('vault_changePassword', { currentPassword: cpCurrent, newPassword: cpNew });
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
            {unlockError && <div className={styles.error}>{unlockError}</div>}
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
                <div
                  className={`${styles.keyDisplay} ${nsec.blurred ? styles.blurred : ''}`}
                  onClick={nsec.toggleBlur}
                >
                  {nsec.value}
                </div>
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
          <div className={styles.section}>
            {!ncValue ? (
              <>
                <p className={styles.explain}>{t('key.ncryptsecExplain')}</p>
                <p className={styles.explain}>{t('key.ncryptsecExplainMore')}</p>
                <div className={styles.warning}>
                  <IconWarning />
                  <span>{t('key.ncryptsecNoRecovery')}</span>
                </div>

                <label>{t('key.encryptionPassword')}</label>
                <Input
                  type="password"
                  showToggle
                  placeholder={t('key.passwordMinChars')}
                  value={ncPassword}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setNcPassword(e.target.value)}
                />
                <Input
                  type="password"
                  placeholder={t('key.confirmPassword')}
                  value={ncConfirm}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setNcConfirm(e.target.value)}
                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && ncReady && generateNcryptsec()}
                />

                {/* Say what is still missing rather than only refusing on submit.
                    The button below is disabled until both are met, so without
                    this the user is left guessing which one it is waiting on. */}
                <ul className={styles.requirements}>
                  <li className={ncLongEnough ? styles.requirementMet : ''}>
                    {ncLongEnough ? '\u2713' : '\u25cb'} {t('key.reqMinChars')}
                  </li>
                  <li className={ncMatches ? styles.requirementMet : ''}>
                    {ncMatches ? '\u2713' : '\u25cb'} {t('key.reqMatch')}
                  </li>
                </ul>

                {ncError && <div className={styles.error}>{ncError}</div>}
                <div className={styles.actions}>
                  <Button variant="secondary" small onClick={handleClose}>{t('common.cancel')}</Button>
                  <Button small onClick={generateNcryptsec} disabled={ncGenerating || !ncReady}>
                    {ncGenerating ? t('key.generating') : t('key.generate')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className={styles.keyDisplay}>{ncValue}</div>
                <div className={styles.hint}>{t('key.storeHint')}</div>
                {/* Download first: the file is the artefact worth keeping, and
                    ncryptsec is the interchange format other clients import.
                    Copying is offered too, but selecting the string by hand
                    should never have been the way to get it out. */}
                <div className={styles.actions}>
                  <Button small onClick={downloadNcryptsec}>{t('key.downloadBackupFile')}</Button>
                  <Button variant="secondary" small onClick={() => ncCopy.copy(ncValue)}>
                    {ncCopy.copied ? t('common.copied') : t('common.copy')}
                  </Button>
                </div>
                <div className={styles.actions}>
                  <Button variant="secondary" small onClick={handleClose}>{t('common.close')}</Button>
                </div>
              </>
            )}
          </div>
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
                <div className={styles.seedGridWrap} onClick={seed.toggleBlur}>
                  <div className={`${styles.seedGrid} ${seed.blurred ? styles.blurred : ''}`}>
                    {seed.value.map((word, i) => (
                      <span key={i} className={styles.seedWord}>
                        <span className={styles.seedWordNum}>{i + 1}</span>
                        {word}
                      </span>
                    ))}
                  </div>
                </div>
                <div className={styles.hint}>{`${t(seed.blurred ? 'key.clickToReveal' : 'key.clickToBlur')} \u00b7 ${t('key.seedAutoHideHint')}`}</div>
                {seedEncMode ? (
                  <>
                    <Input
                      type="password"
                      showToggle
                      placeholder={t('key.seedDownloadPassword')}
                      value={seedEncPw}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setSeedEncPw(e.target.value)}
                    />
                    <Input
                      type="password"
                      placeholder={t('key.seedDownloadConfirm')}
                      value={seedEncConfirm}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setSeedEncConfirm(e.target.value)}
                      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && downloadSeedEncrypted()}
                    />
                    {seedEncError && <div className={styles.error}>{seedEncError}</div>}
                    <div className={styles.actions}>
                      <Button variant="secondary" small onClick={() => { setSeedEncMode(false); setSeedEncPw(''); setSeedEncConfirm(''); setSeedEncError(''); }}>{t('common.cancel')}</Button>
                      <Button small onClick={downloadSeedEncrypted} disabled={seedEncrypting}>
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
                <Input
                  type="password"
                  showToggle
                  placeholder={t('key.newPwMinChars')}
                  value={cpNew}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCpNew(e.target.value)}
                />
                <Input
                  type="password"
                  placeholder={t('key.confirmNewPw')}
                  value={cpConfirm}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCpConfirm(e.target.value)}
                  onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleChangePassword()}
                />
                {cpError && <div className={styles.error}>{cpError}</div>}
                <div className={styles.actions}>
                  <Button variant="secondary" small onClick={handleClose}>{t('common.cancel')}</Button>
                  <Button small onClick={handleChangePassword}>{t('common.save')}</Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </>
    </Modal>
  );
}
