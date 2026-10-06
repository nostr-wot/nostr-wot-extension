import { MIN_ARCHIVE_PASSWORD_LENGTH, MAX_ARCHIVE_PASSWORD_LENGTH } from '@constants/archive.ts';
import { type ReactNode, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { downloadArchive, importArchiveFile, archiveFileNeedsPassword } from '@services/archive/fileTransfer.ts';
import { downloadFile } from '@utils/downloadFile.ts';
import { t } from '@services/i18n/i18n.ts';
import Input from '@components/Input';
import Button from '@components/Button';
import Container from '@components/Container';
import Text from '@components/Text';
import FormError from '@components/FormError';
import Modal from '@components/Modal';
import IconButton from '@components/IconButton';
import IconDownload from '@assets/IconDownload';
import IconUpload from '@assets/IconUpload';

export default function ArchiveFiles({
  accountId,
  disabled,
  onChanged,
  leadingAction,
  trailingAction,
}: {
  accountId: string;
  disabled: boolean;
  onChanged: () => Promise<void>;
  leadingAction?: ReactNode;
  trailingAction?: ReactNode;
}) {
  const [mode, setMode] = useState<'download' | 'import' | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [checkingFile, setCheckingFile] = useState(false);
  const selection = useRef(0);
  const [password, setPassword] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  function close() {
    if (busy) return;
    setMode(null);
    selection.current++;
    setNeedsPassword(false);
    setCheckingFile(false);
    setPassword('');
    setFile(null);
    setError('');
  }
  async function chooseFile(next: File | null) {
    const revision = ++selection.current;
    setFile(null);
    setPassword('');
    setNeedsPassword(false);
    setError('');
    setCheckingFile(true);
    try {
      const encrypted = next ? await archiveFileNeedsPassword(next) : false;
      if (selection.current !== revision) return;
      setNeedsPassword(encrypted);
      setFile(next);
    } catch (e) {
      if (selection.current === revision) setError((e as Error).message);
    } finally {
      if (selection.current === revision) setCheckingFile(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'download') {
        const blob = await downloadArchive(undefined, accountId);
        downloadFile(blob, 'nostr-archive.ndjson');
        setNotice(t('archive.downloaded'));
      } else {
        const count = await importArchiveFile(file!, needsPassword ? password : undefined, accountId);
        setNotice(t('archive.imported', { count }));
        await onChanged();
      }
      setMode(null);
      selection.current++;
      setNeedsPassword(false);
      setCheckingFile(false);
      setPassword('');
      setFile(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Container gap={4}>
      <Container variant="row" gap={3} className="justify-end">
        {leadingAction}
        <IconButton
          size="large"
          tone="brand"
          title={t('archive.download')}
          aria-label={t('archive.download')}
          disabled={disabled || busy}
          onClick={() => { setError(''); setMode('download'); }}
        >
          <IconDownload aria-hidden="true" />
        </IconButton>
        <IconButton
          size="large"
          tone="brand"
          title={t('archive.import')}
          aria-label={t('archive.import')}
          disabled={disabled || busy}
          onClick={() => { setError(''); setMode('import'); }}
        >
          <IconUpload aria-hidden="true" />
        </IconButton>
        {trailingAction}
      </Container>
      {notice && <Text role="status">{notice}</Text>}
      {mode && createPortal(
        <Modal
          title={t(`archive.${mode}`)}
          onClose={close}
          footer={
            <Button
              disabled={
                busy || checkingFile || (mode === 'import' && (!file || (needsPassword &&
                  (password.length < MIN_ARCHIVE_PASSWORD_LENGTH || password.length > MAX_ARCHIVE_PASSWORD_LENGTH))))
              }
              onClick={() => void submit()}
            >
              {busy ? t('common.loading') : t(`archive.${mode}`)}
            </Button>
          }
        >
          <Container gap={5}>
            <Text>{t(mode === 'import' ? 'archive.importHint' : 'archive.fileHint')}</Text>
            {mode === 'import' && (
              <>
                {needsPassword && <Input
                  label={t('archive.filePassword')}
                  maxLength={MAX_ARCHIVE_PASSWORD_LENGTH}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />}
                <input
                  ref={fileInput}
                  type="file"
                  accept=".ndjson,.jsonl,.json"
                  className="hidden"
                  onChange={(event) => void chooseFile(event.target.files?.[0] || null)}
                  disabled={busy}
                />
                <Button variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
                  {t('archive.chooseFile')}
                </Button>
                {file && <Text className="break-all">{file.name}</Text>}
              </>
            )}
            <FormError>{error}</FormError>
          </Container>
        </Modal>, document.body
      )}
    </Container>
  );
}
