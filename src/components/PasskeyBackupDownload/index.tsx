import { useState } from 'react';
import { exportPasskeyRecovery } from '@services/vault/recoveryExportClient';
import { t } from '@services/i18n/i18n.ts';
import { downloadFile } from '@utils/downloadFile.ts';
import Button from '@components/Button';
import FormError from '@components/FormError';
import Container from '@components/Container';

export default function PasskeyBackupDownload({ onDownloaded, compact = false, credentialId }: { credentialId?: string; onDownloaded?: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const backup = await exportPasskeyRecovery('vault_exportPasskeyBackup', credentialId);
      downloadFile(backup, 'nostr-wot-passkey-vault.json');
      onDownloaded?.();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <Container gap={3}><Button small={compact} variant={compact ? "secondary" : "primary"} onClick={download} disabled={busy}>{t(busy ? 'common.loading' : 'passkey.download')}</Button><FormError>{error}</FormError></Container>;
}
