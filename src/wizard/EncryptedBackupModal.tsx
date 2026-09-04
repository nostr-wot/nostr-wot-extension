import Modal from '@components/Modal/Modal';
import EncryptedBackupForm from '@components/EncryptedBackupForm/EncryptedBackupForm';
import { t } from '@lib/i18n.js';

interface EncryptedBackupModalProps {
  /** BackupStep exports from an already-created vault; CreateStep exports mid-onboarding,
   *  before the vault is the current account. Same form, different backend call. */
  rpcMethod: 'vault_exportNcryptsec' | 'onboarding_exportNcryptsec';
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * The wizard's shell around the shared encrypted-backup form.
 *
 * It used to be its own implementation, and a thinner one: two bare password
 * fields, a button that only objected once pressed, no word about the password
 * being unrecoverable, and download as the only way to get the result out. The
 * vault's key dialog had all of that. Nothing about onboarding makes the
 * operation less irreversible, so it now runs the same form.
 *
 * `onSuccess` marks the seed backed up, and the form fires it when the backup
 * has actually left the dialog rather than when it was generated — a file the
 * user never received is not a backup.
 */
export default function EncryptedBackupModal({ rpcMethod, onClose, onSuccess }: EncryptedBackupModalProps) {
  return (
    <Modal title={t('wizard.encryptBackup')} onClose={onClose}>
      <EncryptedBackupForm rpcMethod={rpcMethod} onClose={onClose} onExported={onSuccess} />
    </Modal>
  );
}
