import { useState, useEffect } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { IconKey, IconWarning, IconCopy } from '@assets';
import Button from '@components/Button/Button';
import styles from './SecuritySection.module.css';

type BlockReason = 'read-only' | 'remote-signer' | 'no-seed' | 'short-seed';

interface PqcStatus {
  canDerive: boolean;
  reason: BlockReason | null;
  wordCount: number | null;
  pubkey: string | null;
  keys: { kem: string; dsa: string } | null;
  source: 'derived' | 'imported' | null;
  canImport: boolean;
  attestation: { kind: number; created_at: number; tags: string[][]; content: string } | null;
}

const KEYGEN_SOURCE_URL =
  'https://github.com/nostr-wot/nostr-wot-extension/blob/main/scripts/pqc-keygen.mjs';
const KEYGEN_COMMAND = 'npm run pqc:keygen -- --independent --keyfile keys.json';

/**
 * Import panel for accounts that cannot derive post-quantum keys from a seed.
 *
 * Paste and file picker feed the same parser, so there is one format to get right. The
 * validation that matters happens in the background (`parsePqKeyfile` proves both key
 * pairs by round trip) — this only surfaces the error it returns, which names the
 * specific algorithm and problem rather than saying "invalid file".
 */
function PqcImportPanel({ onImported }: { onImported: (s: PqcStatus) => void }) {
  const [text, setText] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const submit = async (keyfile: string) => {
    setError('');
    setBusy(true);
    try {
      onImported(await rpc<PqcStatus>('pqc_importKeys', { keyfile }));
      setText('');
    } catch (e: any) {
      setError(e?.message || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await submit(await file.text());
    } catch {
      setError(t('pqc.importFileUnreadable'));
    }
  };

  return (
    <div className={styles.pqcImport}>
      <strong>{t('pqc.importTitle')}</strong>
      <p className={styles.desc}>{t('pqc.importDesc')}</p>

      <p className={styles.desc}>{t('pqc.importCommand')}</p>
      <code className={styles.pqcCommand}>{KEYGEN_COMMAND}</code>
      <a
        className={styles.pqcCopyLink}
        href={KEYGEN_SOURCE_URL}
        target="_blank"
        rel="noreferrer noopener"
      >
        {t('pqc.importViewSource')}
      </a>

      <label className={styles.desc} htmlFor="pqc-keyfile">{t('pqc.importPaste')}</label>
      <textarea
        id="pqc-keyfile"
        className={styles.pqcTextarea}
        value={text}
        spellCheck={false}
        placeholder={t('pqc.importPastePlaceholder')}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />

      <div className={styles.pqcImportActions}>
        <Button onClick={() => submit(text)} disabled={busy || !text.trim()}>
          {busy ? t('pqc.importing') : t('pqc.importSubmit')}
        </Button>
        <label className={styles.pqcFileLabel}>
          {t('pqc.importChooseFile')}
          <input type="file" accept="application/json,.json" onChange={onFile} disabled={busy} hidden />
        </label>
      </div>

      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}

export default function PqcSection() {
  const [status, setStatus] = useState<PqcStatus | null>(null);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [revealed, setRevealed] = useState<boolean>(false);
  const [publishing, setPublishing] = useState<boolean>(false);
  const [published, setPublished] = useState<{ sent: number; relays: number } | null>(null);
  const [publishError, setPublishError] = useState<string>('');
  const [existing, setExisting] = useState<{ published: boolean; current: boolean } | null>(null);
  const [removing, setRemoving] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      try {
        setStatus(await rpc<PqcStatus>('pqc_getStatus'));
        // Answered from relays, so it stays right when published from another device.
        setExisting(await rpc<{ published: boolean; current: boolean }>('pqc_checkPublished'));
      } catch (e: any) {
        setError(e?.message || t('common.error'));
      }
    })();
  }, []);

  const handlePublish = async () => {
    setPublishError('');
    setPublishing(true);
    try {
      setPublished(await rpc<{ sent: number; relays: number }>('pqc_publishAttestation'));
    } catch (e: any) {
      setPublishError(e?.message || t('common.error'));
    } finally {
      setPublishing(false);
    }
  };

  const handleCopy = async () => {
    if (!status?.attestation) return;
    await navigator.clipboard.writeText(JSON.stringify(status.attestation));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRemoveImported = async () => {
    if (!confirm(t('pqc.importRemoveConfirm'))) return;
    setRemoving(true);
    try {
      await rpc('pqc_removeImportedKeys');
      setStatus(await rpc<PqcStatus>('pqc_getStatus'));
      setPublished(null);
      setExisting(await rpc<{ published: boolean; current: boolean }>('pqc_checkPublished'));
    } catch (e: any) {
      setError(e?.message || t('common.error'));
    } finally {
      setRemoving(false);
    }
  };

  if (error) return <div className={styles.error}>{error}</div>;
  if (!status) return <p className={styles.desc}>{t('common.loading')}</p>;

  const imported = status.source === 'imported';

  // Cannot derive — explain why, and offer the import path where it would actually work.
  if (!status.canDerive) {
    const reason = status.reason as BlockReason;
    return (
      <div className={styles.pqcBlocked}>
        <div className={styles.pqcNotice}>
          <IconWarning size={18} />
          <div>
            <strong>{t('pqc.unavailableTitle')}</strong>
            <p>
              {reason === 'short-seed'
                ? t('pqc.reasonShortSeed', { count: status.wordCount ?? 12 })
                : t(`pqc.reason.${reason}`)}
            </p>
          </div>
        </div>
        {/* Only accounts that hold a local signing key can use an imported key — a
            read-only or remote-signer account would store secrets nothing can use. */}
        {status.canImport && <PqcImportPanel onImported={setStatus} />}
      </div>
    );
  }

  return (
    <div>
      <div className={styles.pqcNoticeOk}>
        <IconKey size={18} />
        <div>
          <strong>{imported ? t('pqc.importedTitle') : t('pqc.readyTitle')}</strong>
          <p>{t('pqc.readyDesc')}</p>
        </div>
      </div>

      {/* Persistent, not a one-time dialog: an imported key is the one thing in this
          extension the seed phrase cannot bring back. */}
      {imported && (
        <div className={styles.pqcNotice}>
          <IconWarning size={18} />
          <div><p>{t('pqc.importedBackupWarning')}</p></div>
        </div>
      )}

      {/* Publishing is what makes the account reachable, so it comes before the keys
          rather than behind a reveal step nobody needs to take. */}
      <p className={styles.desc}>{t('pqc.publishDesc')}</p>

      {existing?.published && existing.current ? (
        <p className={styles.pqcPublished}>{t('pqc.alreadyPublished')}</p>
      ) : published ? (
        <p className={styles.pqcPublished}>
          {t('pqc.published', { sent: published.sent, relays: published.relays })}
        </p>
      ) : (
        <>
          {existing?.published && !existing.current && (
            <p className={styles.desc}>{t('pqc.staleAttestation')}</p>
          )}
          <Button onClick={handlePublish} disabled={publishing}>
            {publishing ? t('pqc.publishing') : t('pqc.publish')}
          </Button>
        </>
      )}

      {publishError && <div className={styles.error}>{publishError}</div>}

      {!revealed ? (
        <div style={{ marginTop: 14 }}>
          <Button variant="secondary" onClick={() => setRevealed(true)}>{t('pqc.showKeys')}</Button>
        </div>
      ) : (
        <>
          <div className={styles.pqcKeyRow}>
            <span>ml-kem-1024</span>
            <code>{status.keys!.kem.slice(0, 32)}…</code>
          </div>
          <div className={styles.pqcKeyRow}>
            <span>ml-dsa-87</span>
            <code>{status.keys!.dsa.slice(0, 32)}…</code>
          </div>

          {/* Copy stays available for anyone who would rather publish it themselves. */}
          <button className={styles.pqcCopyLink} onClick={handleCopy}>
            <IconCopy size={12} />
            {copied ? t('common.copied') : t('pqc.copyAttestation')}
          </button>
        </>
      )}

      {/* Importing the wrong key file must not be a permanent state. */}
      {imported && (
        <div style={{ marginTop: 14 }}>
          <Button variant="secondary" onClick={handleRemoveImported} disabled={removing}>
            {t('pqc.importRemove')}
          </Button>
        </div>
      )}

      <p className={styles.pqcLimits}>{t('pqc.limits')}</p>
    </div>
  );
}
