import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { rpc } from '@shared/rpc.ts';
import {
  isAlreadyPublished,
  type PqcBlockReason,
} from '@shared/pqcState.ts';
import { usePqc } from '../../context/PqcContext';
import { t } from '@lib/i18n.js';
import { IconKey, IconWarning, IconCopy } from '@assets';
import Button from '@components/Button/Button';
import Modal from '@components/Modal/Modal';
import PqcExportModal from './PqcExportModal';
import HowItWorks from './PqcHowItWorks';
import PqcImportPanel from './PqcImportPanel';
import KeyRow from './PqcKeyRow';
import ConfirmDialog from '@components/ConfirmDialog/ConfirmDialog';
import StatusNotice from '@components/StatusNotice/StatusNotice';
import useCopy from '@shared/hooks/useCopy.ts';
import { truncateMiddle } from '@shared/format/text.ts';
import { downloadFile } from '@shared/downloadFile.ts';
import { encryptBackup } from '@lib/crypto/keyBackup.ts';
import browser from '@shared/browser.ts';
import styles from './PqcSection.module.css';



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

/**
 * Import panel for accounts that cannot derive post-quantum keys from a seed.
 *
 * Paste and file picker feed the same parser, so there is one format to get right. The
 * validation that matters happens in the background (`parsePqKeyfile` proves both key
 * pairs by round trip) — this only surfaces the error it returns, which names the
 * specific algorithm and problem rather than saying "invalid file".
 */
export interface PqcSectionHandle {
  openHowItWorks: () => void;
}

function PqcSection(_props: unknown, ref: React.Ref<PqcSectionHandle>) {
  // Status and the published check both come from PqcContext now — this panel
  // and the home-screen card used to each call `pqc_getStatus` and
  // `pqc_checkPublished` on their own mount. The decision logic
  // (`isAlreadyPublished`) stays here in `@shared/pqcState.ts`'s exports; the
  // context only supplies the data.
  const { status, published: existing, error, refresh } = usePqc();
  const attestationCopy = useCopy();
  const [publishing, setPublishing] = useState<boolean>(false);
  const [published, setPublished] = useState<{ sent: number; relays: number } | null>(null);
  const [publishError, setPublishError] = useState<string>('');
  const [removing, setRemoving] = useState<boolean>(false);
  const [howOpen, setHowOpen] = useState<boolean>(false);
  const [keysOpen, setKeysOpen] = useState<boolean>(false);
  const [confirmRemove, setConfirmRemove] = useState<boolean>(false);
  const [removeError, setRemoveError] = useState<string>('');
  const [exportOpen, setExportOpen] = useState<boolean>(false);

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
      await refresh();
    } catch (e: any) {
      setRemoveError(e?.message || t('common.error'));
    } finally {
      setRemoving(false);
    }
  };

  const how = howOpen ? <HowItWorks onClose={closeHow} /> : null;

  if (error) return <>{how}<div className={styles.error}>{error}</div></>;
  // Gated on `status` alone, not a `loading` flag: PqcContext's `loading` also
  // flips true on a passive background refresh (the relay-cache push, or an
  // account switch), and this panel already has a perfectly good status to
  // keep showing while that happens behind it — reverting to "Loading…" on a
  // refresh nobody asked for would be a regression from what this looked like
  // before it shared its data with the home-screen card.
  if (!status) return <>{how}<p className={styles.desc}>{t('common.loading')}</p></>;

  const imported = status.source === 'imported';

  // Cannot derive — explain why, and offer the import path where it would actually work.
  if (!status.canDerive) {
    const reason = status.reason as PqcBlockReason;
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
        {status.canImport && <PqcImportPanel />}
      </div>
      </>
    );
  }

  const alreadyPublished = isAlreadyPublished(existing, !!published);

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
              <button className={styles.pqcCopyLink} onClick={refresh}>{t('common.retry')}</button>
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
              <button className={styles.pqcCopyLink} onClick={() => status?.attestation && attestationCopy.copy(JSON.stringify(status.attestation))}>
                <IconCopy size={12} />
                {attestationCopy.copied ? t('common.copied') : t('pqc.copyAttestation')}
              </button>
            </>
          )}
        </Modal>
      )}

      {exportOpen && <PqcExportModal onClose={() => setExportOpen(false)} />}

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
