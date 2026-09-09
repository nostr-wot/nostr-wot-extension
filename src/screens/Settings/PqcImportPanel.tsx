import { KEYGEN_SOURCE_URL, KEYGEN_COMMAND } from '@constants/pqc.ts';
import React, { useState, useRef } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import Button from '@components/Button/Button';
import { type PqcPanelStatus as PqcStatus } from '@domain/pqc/pqcState.ts';
import { usePqc } from '@context/PqcContext';
import FormError from '@components/FormError/FormError';
import Textarea from '@components/Textarea/Textarea';

import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

/** Import independently generated post-quantum keys from a key file. */
export default function PqcImportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
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
    <Container gap={4} className="rounded-panel border border-card-border p-7">
      <strong className="text-md text-heading">{t('pqc.importTitle')}</strong>
      <Text variant="secondary" as="p" className="text-sm leading-loose">{t('pqc.importDesc')}</Text>

      <Textarea
        label={t('pqc.importPaste')}
        id="pqc-keyfile"
        className="min-h-44 max-h-80 overflow-y-auto font-code text-xs"
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
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>{t('pqc.importChooseFile')}</Button>
        <input ref={fileRef} type="file" accept="application/json,.json,.txt,text/plain" onChange={onFile} disabled={busy} hidden />
      </Container>

      <FormError>{error}</FormError>

      {/* The one-off part, folded away: you generate the file once, then come back here to
          paste it. Keeping it expanded pushed the paste box and buttons off-screen. */}
      <details className="mt-4 text-sm text-secondary">
        <summary className="cursor-pointer py-3 font-semibold">{t('pqc.importCommand')}</summary>
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
