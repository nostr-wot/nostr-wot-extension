import React, { useState } from 'react';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import { type PqcPanelStatus as PqcStatus } from '@shared/pqcState.ts';
import { usePqc } from '@popup/context/PqcContext';
import styles from './PqcSection.module.css';

const KEYGEN_SOURCE_URL =
  'https://github.com/nostr-wot/nostr-wot-extension/blob/main/scripts/pqc-keygen.mjs';
const KEYGEN_COMMAND = 'npm run pqc:keygen -- --independent --keyfile keys.json';

/** Import independently generated post-quantum keys from a key file. */
export default function PqcImportPanel() {
  const { applyStatus } = usePqc();
  const [text, setText] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const submit = async (keyfile: string) => {
    setError('');
    setBusy(true);
    try {
      // Optimistic: `pqc_importKeys` already returns the new status, so
      // updating the shared context with it directly saves the round trip a
      // `refresh()` would otherwise repeat.
      applyStatus(await rpc<PqcStatus>('pqc_importKeys', { keyfile }));
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
