import React, { useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';
import { type PqcPanelStatus as PqcStatus } from '@domain/pqc/pqcState.ts';
import { usePqc } from '@context/PqcContext';
import styles from './PqcSection.module.css';
import FormError from '@components/FormError/FormError';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

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
    <Container gap={4} className="mt-6 pt-6 border-t border-card-border">
      <strong className="text-md text-heading">{t('pqc.importTitle')}</strong>
      <Text variant="secondary" as="p" className="text-sm my-4 mb-6">{t('pqc.importDesc')}</Text>

      <SectionLabel className="mb-6 mt-4 font-normal leading-loose" htmlFor="pqc-keyfile">{t('pqc.importPaste')}</SectionLabel>
      <textarea
        id="pqc-keyfile"
        className="w-full min-h-44 py-4 px-5 border border-card-border rounded-sm bg-input text-body font-code text-xs leading-normal resize-y"
        value={text}
        spellCheck={false}
        placeholder={t('pqc.importPastePlaceholder')}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />

      <Container variant="row" gap={5} className="flex-wrap">
        <Button onClick={() => submit(text)} disabled={busy || !text.trim()}>
          {busy ? t('pqc.importing') : t('pqc.importSubmit')}
        </Button>
        <label className="text-sm text-brand cursor-pointer underline underline-offset-2 hover:opacity-85">
          {t('pqc.importChooseFile')}
          <input type="file" accept="application/json,.json,.txt,text/plain" onChange={onFile} disabled={busy} hidden />
        </label>
      </Container>

      <FormError>{error}</FormError>

      {/* The one-off part, folded away: you generate the file once, then come back here to
          paste it. Keeping it expanded pushed the paste box and buttons off-screen. */}
      <details className={`${styles.pqcGenerate} mt-6 text-xs`}>
        <summary>{t('pqc.importCommand')}</summary>
        <code className="block py-4 px-5 border border-card-border rounded-sm bg-sunken font-code text-xs text-heading break-all select-all">{KEYGEN_COMMAND}</code>
        {/* No mt-5 here: this anchor is a direct child of `.pqcGenerate`,
            whose `> *` rule already sets its margin-top (and, being an
            unlayered CSS Module rule, would win over a layered utility
            trying to override it anyway — see PqcSection.module.css). */}
        <a
          className="inline-flex items-center gap-2.5 text-xs text-muted cursor-pointer hover:text-brand"
          href={KEYGEN_SOURCE_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          {t('pqc.importViewSource')}
        </a>
      </details>
    </Container>
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
