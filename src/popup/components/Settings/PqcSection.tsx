import React, { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { IconKey, IconWarning, IconCopy } from '@assets';
import Button from '@components/Button/Button';
import Modal from '@components/Modal/Modal';
import ConfirmDialog from '@components/ConfirmDialog/ConfirmDialog';
import StatusNotice from '@components/StatusNotice/StatusNotice';
import useCopy from '@shared/hooks/useCopy.ts';
import { truncateMiddle } from '@shared/format/text.ts';
import { downloadFile } from '@shared/downloadFile.js';
import { encryptBackup } from '@lib/crypto/keyBackup.ts';
import browser from '@shared/browser.ts';
import styles from './SecuritySection.module.css';

type BlockReason = 'read-only' | 'remote-signer' | 'no-seed' | 'short-seed';

interface Published {
  published: boolean;
  current: boolean;
  /** True when no relay answered, so `published` carries no information. */
  unreachable?: boolean;
}

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

/**
 * Step-by-step guide, linked from the panel. Kept as one constant so it is changed in one
 * place rather than hunted through six locale files.
 *
 * Points at the extension-facing guide, not the command-line one: someone who tapped this
 * link is in the popup, not at a terminal. English only on the site today (next-intl is
 * configured `localePrefix: 'as-needed'`, so the default locale is unprefixed and this URL
 * resolves). Linking the unprefixed English page from every locale is deliberate — it
 * exists, whereas /es/guides/... does not.
 */
const GUIDE_URL = 'https://nostr-wot.com/guides/turn-on-post-quantum-keys';

/** Remembers that the explainer has been shown once, so it does not reappear every visit. */
const HOW_SEEN_KEY = 'pqcHowItWorksSeen';

/**
 * What this actually does, in the order it happens.
 *
 * Shown once, the first time the panel is opened, and reachable afterwards from the info
 * button in the panel header. It used to sit inline above everything else, which pushed
 * the import panel below the fold — a user who came here specifically to add their own key
 * could not see where to do it without scrolling past an explanation they had already read.
 */
function HowItWorks({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title={t('pqc.howTitle')}
      onClose={onClose}
      zIndex={720}
      footer={<Button onClick={onClose}>{t('common.gotIt')}</Button>}
    >
      <ol className={styles.pqcSteps}>
        <li>{t('pqc.howStep1')}</li>
        <li>{t('pqc.howStep2')}</li>
        <li>{t('pqc.howStep3')}</li>
      </ol>
      <p className={styles.pqcHowLimit}>{t('pqc.howLimit')}</p>
      <a className={styles.pqcCopyLink} href={GUIDE_URL} target="_blank" rel="noreferrer noopener">
        {t('pqc.guideLink')}
      </a>
    </Modal>
  );
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
          <input type="file" accept="application/json,.json,.txt,text/plain" onChange={onFile} disabled={busy} hidden />
        </label>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* The one-off part, folded away: you generate the file once, then come back here to
          paste it. Keeping it expanded pushed the paste box and buttons off-screen. */}
      <details className={styles.pqcGenerate}>
        <summary>{t('pqc.importCommand')}</summary>
        <code className={styles.pqcCommand}>{KEYGEN_COMMAND}</code>
        <a
          className={styles.pqcCopyLink}
          href={KEYGEN_SOURCE_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          {t('pqc.importViewSource')}
        </a>
      </details>
    </div>
  );
}

/**
 * One key: its algorithm, a shortened form of the value, and a copy button.
 *
 * Shortened in the middle rather than the end. A post-quantum key is thousands
 * of base64 characters with nothing a person reads in the middle, but both ends
 * are what someone checks a value against — truncating the tail hides half of
 * what showing it was for. What goes to the clipboard is always the whole thing.
 */
function KeyRow({ label, value }: { label: string; value: string }) {
  const { copy, copied, failed } = useCopy();
  return (
    <div className={styles.pqcKeyRow}>
      <span>{label}</span>
      <code title={value}>{truncateMiddle(value, 12, 10)}</code>
      <button
        className={styles.pqcKeyCopy}
        onClick={() => copy(value)}
        aria-label={t('common.copy')}
        title={t('common.copy')}
      >
        <IconCopy size={12} />
        {copied ? t('common.copied') : failed ? t('common.error') : ''}
      </button>
    </div>
  );
}

export interface PqcSectionHandle {
  openHowItWorks: () => void;
}

function PqcSection(_props: unknown, ref: React.Ref<PqcSectionHandle>) {
  const [status, setStatus] = useState<PqcStatus | null>(null);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [publishing, setPublishing] = useState<boolean>(false);
  const [published, setPublished] = useState<{ sent: number; relays: number } | null>(null);
  const [publishError, setPublishError] = useState<string>('');
  const [existing, setExisting] = useState<Published | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [removing, setRemoving] = useState<boolean>(false);
  const [howOpen, setHowOpen] = useState<boolean>(false);
  const [keysOpen, setKeysOpen] = useState<boolean>(false);
  const [confirmRemove, setConfirmRemove] = useState<boolean>(false);
  const [removeError, setRemoveError] = useState<string>('');
  const [exportOpen, setExportOpen] = useState<boolean>(false);
  const [exportPw, setExportPw] = useState<string>('');
  const [exportConfirmPw, setExportConfirmPw] = useState<string>('');
  const [exportBusy, setExportBusy] = useState<boolean>(false);
  const [exportError, setExportError] = useState<string>('');

  useImperativeHandle(ref, () => ({ openHowItWorks: () => setHowOpen(true) }), []);

  // First visit only: explain before asking for a decision, then get out of the way.
  useEffect(() => {
    (async () => {
      try {
        const data = await browser.storage.local.get(HOW_SEEN_KEY) as Record<string, boolean>;
        if (!data[HOW_SEEN_KEY]) setHowOpen(true);
      } catch { /* never block the panel on this */ }
    })();
  }, []);

  const closeHow = () => {
    setHowOpen(false);
    browser.storage.local.set({ [HOW_SEEN_KEY]: true }).catch(() => {});
  };

  /**
   * Load everything this panel decides on, and only then render it.
   *
   * The publish check is a relay round trip and can take seconds. Rendering as
   * soon as pqc_getStatus returned meant the panel drew its whole decided state
   * against a publish answer it did not have yet — so a user whose attestation
   * was already live got "Publish this event to your relays…" and a Publish
   * button, which then swapped for "already published and up to date" once the
   * relays replied. A wrong instruction is worse than a spinner.
   *
   * The two run in parallel rather than in sequence: both are needed before
   * anything renders, so waiting for the first before starting the second only
   * added its latency to the total.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const status = await rpc<PqcStatus>('pqc_getStatus');
      setStatus(status);

      // An account that cannot derive never reaches the publish UI, so making it
      // wait on relays it will not use would be latency for nothing.
      if (!status.canDerive) {
        setExisting(null);
        return;
      }

      setExisting(await rpc<Published>('pqc_checkPublished'));
    } catch (e: any) {
      setError(e?.message || t('common.error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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

  // Was a native confirm(). Some popup contexts suppress those outright, which
  // made Remove a button that sometimes silently did nothing — on a destructive
  // action. Now the shared dialog, which also survives a failure visibly.
  const handleRemoveImported = async () => {
    setRemoveError('');
    setRemoving(true);
    try {
      await rpc('pqc_removeImportedKeys');
      setPublished(null);
      setConfirmRemove(false);
      await load();
    } catch (e: any) {
      setRemoveError(e?.message || t('common.error'));
    } finally {
      setRemoving(false);
    }
  };

  /**
   * Save the key file, optionally encrypted under a password.
   *
   * Same two options and the same envelope as the seed-phrase export — one
   * implementation now, in lib/crypto/keyBackup.ts, where a test proves the file
   * can be read back. Producing a backup nobody has ever decrypted is not a
   * thing to do twice.
   *
   * The exported shape is what our own importer accepts, so a file saved here
   * can be imported here. That round trip is the format's only real spec.
   */
  const handleExport = async (encrypted: boolean) => {
    setExportError('');
    if (encrypted) {
      if (exportPw.length < 8) { setExportError(t('key.passwordMin8')); return; }
      if (exportPw !== exportConfirmPw) { setExportError(t('key.passwordsNoMatch')); return; }
    }
    setExportBusy(true);
    try {
      const res = await rpc<{ keyfile: string; filename: string }>('pqc_exportKeys');
      if (encrypted) {
        downloadFile(await encryptBackup(res.keyfile, exportPw), res.filename.replace(/\.json$/, '-encrypted.json'));
      } else {
        downloadFile(res.keyfile, res.filename);
      }
      setExportOpen(false);
      setExportPw('');
      setExportConfirmPw('');
    } catch (e: any) {
      setExportError(e?.message || t('common.error'));
    } finally {
      setExportBusy(false);
    }
  };

  const how = howOpen ? <HowItWorks onClose={closeHow} /> : null;

  if (error) return <>{how}<div className={styles.error}>{error}</div></>;
  // Nothing is drawn until every answer this panel branches on is in hand.
  if (loading || !status) return <>{how}<p className={styles.desc}>{t('common.loading')}</p></>;

  const imported = status.source === 'imported';

  // Cannot derive — explain why, and offer the import path where it would actually work.
  if (!status.canDerive) {
    const reason = status.reason as BlockReason;
    return (
      <>
      {how}
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
      </>
    );
  }

  const alreadyPublished = !!(existing?.published && existing.current) || !!published;

  return (
    <div>
      {how}

      {/* What this does and does not protect, first. It is the frame for every
          decision below it, and it was sitting at the very bottom where it read
          as a footnote to a screen the user had already acted on. */}
      <p className={styles.pqcLimits}>{t('pqc.limits')}</p>

      {/* One line each instead of two paragraphs, and one component for both so
          the pair cannot drift apart — the state and its caveat read as one
          thing. The prose is in the tooltips: reference material, wanted once and
          in the way every visit after.

          `info` is not readyDesc when imported: that one says the keys come from
          the seed phrase, which for an imported key is false — and contradicted
          the backup warning sitting right beside it. */}
      <StatusNotice
        tone="ok"
        icon={<IconKey size={18} />}
        label={imported ? t('pqc.importedTitle') : t('pqc.readyTitle')}
        info={imported ? t('pqc.importedDesc') : t('pqc.readyDesc')}
      />

      {imported && (
        <StatusNotice
          tone="warn"
          icon={<IconWarning size={18} />}
          label={t('pqc.importedBackupShort')}
          info={t('pqc.importedBackupWarning')}
        />
      )}

      {alreadyPublished ? (
        <p className={styles.pqcPublished}>
          {published
            ? t('pqc.published', { sent: published.sent, relays: published.relays })
            : t('pqc.alreadyPublished')}
        </p>
      ) : (
        <>
          {/* No relay answered, so whether this is published is genuinely unknown.
              Saying "not published yet" would be a guess, and the guess costs a
              needless republish of an attestation that may already be correct. */}
          {existing?.unreachable && (
            <div className={styles.pqcNoticeInline}>
              <IconWarning size={16} />
              <span>{t('pqc.checkFailed')}</span>
              <button className={styles.pqcCopyLink} onClick={load}>{t('common.retry')}</button>
            </div>
          )}
          {/* Only while it is still an instruction. Telling someone to publish,
              directly above a line saying they already have, was the panel
              arguing with itself. */}
          {!existing?.unreachable && <p className={styles.desc}>{t('pqc.publishDesc')}</p>}
          {existing?.published && !existing.current && (
            <p className={styles.desc}>{t('pqc.staleAttestation')}</p>
          )}
          <Button onClick={handlePublish} disabled={publishing}>
            {publishing ? t('pqc.publishing') : t('pqc.publish')}
          </Button>
        </>
      )}

      {publishError && <div className={styles.error}>{publishError}</div>}

      <div className={styles.pqcActions}>
        <Button variant="secondary" onClick={() => setKeysOpen(true)}>{t('pqc.showKeys')}</Button>
        {/* Importing the wrong key file must not be a permanent state. */}
        <Button variant="secondary" onClick={() => setExportOpen(true)}>{t('pqc.exportKeys')}</Button>
        {imported && (
          <Button variant="danger" onClick={() => setConfirmRemove(true)} disabled={removing}>
            {t('pqc.importRemove')}
          </Button>
        )}
      </div>

      {keysOpen && status.keys && (
        <Modal
          title={t('pqc.keysTitle')}
          onClose={() => setKeysOpen(false)}
          zIndex={720}
          footer={<Button onClick={() => setKeysOpen(false)}>{t('common.close')}</Button>}
        >
          {/* Shortened in the middle, not the end. These are thousands of base64
              characters with nothing readable in them, but the two ends are what
              someone compares a key by — truncating only the tail hides half of
              what the display is for. The full value goes to the clipboard. */}
          <KeyRow label="ml-kem-1024" value={status.keys.kem} />
          <KeyRow label="ml-dsa-87" value={status.keys.dsa} />

          {status.attestation && (
            <>
              <p className={styles.desc}>{t('pqc.attestationLabel')}</p>
              <pre className={styles.pqcJson}>{JSON.stringify(status.attestation, null, 2)}</pre>
              {/* For anyone who would rather publish it themselves. */}
              <button className={styles.pqcCopyLink} onClick={handleCopy}>
                <IconCopy size={12} />
                {copied ? t('common.copied') : t('pqc.copyAttestation')}
              </button>
            </>
          )}
        </Modal>
      )}

      {exportOpen && (
        <Modal
          title={t('pqc.exportKeys')}
          onClose={() => { setExportOpen(false); setExportError(''); }}
          zIndex={720}
        >
          <p className={styles.desc}>{t('pqc.exportDesc')}</p>
          <StatusNotice
            tone="warn"
            icon={<IconWarning size={18} />}
            label={t('pqc.exportWarnShort')}
            info={t('pqc.exportWarn')}
          />

          <label className={styles.desc} htmlFor="pqc-export-pw">{t('key.encryptionPassword')}</label>
          <input
            id="pqc-export-pw"
            type="password"
            className={styles.pqcInput}
            value={exportPw}
            autoComplete="new-password"
            onChange={(e) => setExportPw(e.target.value)}
            disabled={exportBusy}
          />
          <input
            type="password"
            className={styles.pqcInput}
            placeholder={t('key.confirmPassword')}
            value={exportConfirmPw}
            autoComplete="new-password"
            onChange={(e) => setExportConfirmPw(e.target.value)}
            disabled={exportBusy}
          />

          {exportError && <div className={styles.error}>{exportError}</div>}

          <div className={styles.pqcActions}>
            <Button onClick={() => handleExport(true)} disabled={exportBusy}>
              {exportBusy ? t('common.loading') : t('key.downloadEncrypted')}
            </Button>
            {/* Plain stays available — the generator writes plaintext key files
                and some people keep them on hardware that has no password. It is
                second, and not the default. */}
            <Button variant="secondary" onClick={() => handleExport(false)} disabled={exportBusy}>
              {t('key.downloadPlain')}
            </Button>
          </div>
        </Modal>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title={t('pqc.importRemove')}
          message={t('pqc.importRemoveConfirm')}
          confirmLabel={t('pqc.importRemove')}
          danger
          busy={removing}
          error={removeError}
          zIndex={720}
          onConfirm={handleRemoveImported}
          onCancel={() => { setConfirmRemove(false); setRemoveError(''); }}
        />
      )}
    </div>
  );
}

export default forwardRef(PqcSection);
