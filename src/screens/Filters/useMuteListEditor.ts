import { useEffect, useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { toHexPubkey, type MyMuteList, type MuteListRead } from '@domain/mutes/muteList.ts';
import { mergeUnique } from '@utils/collections.ts';
import useAsyncScope from '@hooks/useAsyncScope.ts';
import useTransientState from '@hooks/useTransientState.ts';

/** Mounted once per account/editor session. Never publish after an unanswered read. */
export default function useMuteListEditor() {
  const [list, setList] = useState<MyMuteList | null>(null);
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useTransientState<'success' | 'error' | null>(null, 3000);
  const [importValue, setImportValue] = useState('');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const scope = useAsyncScope();
  const busy = loading || importing || publishing;

  const reload = async () => {
    const current = scope.start();
    setLoading(true);
    setReadFailed(false);
    try {
      const data = await rpc<MuteListRead>('getMyMuteList', { fresh: true });
      if (!current()) return;
      if (!data || data.reachable === false) setReadFailed(true);
      else { setList(data); setDirty(false); }
    } catch { if (current()) setReadFailed(true); }
    finally { if (current()) setLoading(false); }
  };
  // This hook's owner is keyed by account and unmounted when the overlay closes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, []);

  const update = (patch: Partial<MyMuteList>) => {
    if (busy || readFailed || !list) return;
    setList(previous => previous ? { ...previous, ...patch } : previous);
    setDirty(true);
    setPublishResult(null);
  };
  const handleImport = async () => {
    if (busy || readFailed || !list) return;
    const hex = toHexPubkey(importValue);
    if (!hex) { setImportError(t('mutes.invalidPubkey')); return; }
    const current = scope.start();
    setImportError('');
    setImporting(true);
    try {
      const result = await rpc<MuteListRead & { ok?: boolean }>('fetchMuteList', { pubkey: hex });
      if (!current()) return;
      if (!result || result.reachable === false || result.ok === false) setImportError(t('mutes.failedFetch'));
      else if (!result.people.length) setImportError(t(result.createdAt ? 'mutes.noPublicPeople' : 'mutes.noMuteListFound'));
      else {
        const people = mergeUnique(list.people, result.people.filter(Boolean));
        if (people.length > list.people.length) {
          setList({ ...list, people });
          setDirty(true);
          setPublishResult(null);
        } else setImportError(t('mutes.nothingNew'));
        setImportValue('');
      }
    } catch { if (current()) setImportError(t('mutes.failedFetch')); }
    finally { if (current()) setImporting(false); }
  };
  const handlePublish = async () => {
    if (busy || readFailed || !list || !dirty) return;
    const current = scope.start();
    setPublishing(true);
    setPublishResult(null);
    try {
      // rawContent must survive unchanged: it contains encrypted private mutes.
      const result = await rpc<{ sent?: boolean }>('publishMuteList', { ...list, readReachable: true });
      if (!current()) return;
      setPublishResult(result?.sent ? 'success' : 'error');
      if (result?.sent) setDirty(false);
    } catch { if (current()) setPublishResult('error'); }
    finally { if (current()) setPublishing(false); }
  };
  return { list, loading, readFailed, dirty, publishing, publishResult, importValue, importError,
    importing, busy, reload, update, handleImport, handlePublish,
    changeImport: (value: string) => { setImportValue(value); setImportError(''); } };
}
