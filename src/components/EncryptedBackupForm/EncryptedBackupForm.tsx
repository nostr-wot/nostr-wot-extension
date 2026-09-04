import { useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { downloadFile } from '@utils/downloadFile.ts';
import useCopy from '@hooks/useCopy.ts';
import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import PasswordPairFields from '@components/PasswordPairFields/PasswordPairFields';
import usePasswordPair from '@hooks/usePasswordPair.ts';
import { IconWarning } from '@assets';
import FormError from '@components/FormError/FormError';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';

const CLS = {
  section: 'flex flex-col gap-5',
  explain: 'text-sm leading-normal text-secondary',
  // rgba(220,38,38,0.06) is a one-off, not --error-tint (0.08) — kept exact
  // rather than snapped to the nearest existing tint.
  warning: 'flex items-start gap-4 px-6 py-5 bg-[rgba(220,38,38,0.06)] rounded-panel text-sm text-error leading-normal',
  keyDisplay: 'p-6 bg-card border border-card-border rounded-panel font-mono-alt text-xs text-heading ' +
    'break-all leading-loose cursor-pointer transition-[filter] duration-slow',
  hint: 'text-xs text-muted text-center',
  actions: 'flex gap-4 justify-end mt-2',
};

/**
 * Export the key as an `ncryptsec`: pick a password, then take the result away.
 *
 * There were two of these. The vault's key dialog had the full treatment —
 * what the format is, that nobody can recover the password, a live checklist of
 * what the password still needs, and both a download and a copy. The wizard's
 * had two bare password fields, a button that only objected once pressed, and
 * download as the only way out. Same operation, same irreversible consequence,
 * two different amounts of care. This is the one implementation.
 *
 * Deliberately not a Modal: the vault dialog is already inside one and switches
 * between four actions, so a modal here would nest. Each caller supplies the
 * shell and this supplies the body, including its own actions.
 */

interface EncryptedBackupFormProps {
  /** The vault dialog exports the current account; the wizard exports mid-onboarding,
   *  before the new vault is the current account. Same form, different backend call. */
  rpcMethod: 'vault_exportNcryptsec' | 'onboarding_exportNcryptsec';
  onClose: () => void;
  /** Fires once the backup has actually left the dialog — downloaded or copied.
   *  Generating it is not the same as keeping it. */
  onExported?: () => void;
}

export default function EncryptedBackupForm({ rpcMethod, onClose, onExported }: EncryptedBackupFormProps) {
  const pair = usePasswordPair();
  const [value, setValue] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [generating, setGenerating] = useState<boolean>(false);
  const copy = useCopy();

  const generate = async () => {
    if (!pair.ready) return;
    setError('');
    setGenerating(true);
    try {
      const result = await rpc<string>(rpcMethod, { password: pair.password });
      if (result) setValue(result);
      else setError(t('key.failedExport'));
    } catch {
      setError(t('key.failedExport'));
    }
    setGenerating(false);
  };

  const download = () => {
    downloadFile(value, `nostr-key-${Date.now()}.ncryptsec`);
    onExported?.();
  };

  const handleCopy = async () => {
    await copy.copy(value);
    // Only on a write the browser actually accepted — useCopy exists because a
    // refused clipboard is otherwise indistinguishable from a successful one.
    if (!copy.failed) onExported?.();
  };

  if (value) {
    return (
      <div className={CLS.section}>
        <div className={CLS.keyDisplay}>{value}</div>
        <div className={CLS.hint}>{t('key.storeHint')}</div>
        {/* Download first: the file is the artefact worth keeping, and ncryptsec
            is the interchange format other clients import. Copying is offered
            too, but selecting the string by hand should never have been the
            only way to get it out. */}
        <div className={CLS.actions}>
          <Button small onClick={download}>{t('key.downloadBackupFile')}</Button>
          <Button variant="secondary" small onClick={handleCopy}>
            {copy.copied ? t('common.copied') : t('common.copy')}
          </Button>
        </div>
        <div className={CLS.actions}>
          <Button variant="secondary" small onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={CLS.section}>
      <p className={CLS.explain}>{t('key.ncryptsecExplain')}</p>
      <p className={CLS.explain}>{t('key.ncryptsecExplainMore')}</p>
      {/* The password is the only thing standing between this file and the key,
          and there is nobody to ask if it is forgotten. Said before the fields,
          not after the export. */}
      <div className={CLS.warning}>
        <IconWarning />
        <span>{t('key.ncryptsecNoRecovery')}</span>
      </div>

      <SectionLabel>{t('key.encryptionPassword')}</SectionLabel>
      <PasswordPairFields
        pair={pair}
        passwordPlaceholder={t('key.passwordMinChars')}
        confirmPlaceholder={t('key.confirmPassword')}
        onSubmit={generate}
        disabled={generating}
      />

      <FormError>{error}</FormError>
      <div className={CLS.actions}>
        <Button variant="secondary" small onClick={onClose}>{t('common.cancel')}</Button>
        <Button small onClick={generate} disabled={generating || !pair.ready}>
          {generating ? t('key.generating') : t('key.generate')}
        </Button>
      </div>
    </div>
  );
}
