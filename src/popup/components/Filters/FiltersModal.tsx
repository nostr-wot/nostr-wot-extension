import React, { useState, useEffect, useRef, ChangeEvent } from 'react';
import { rpc } from '@shared/rpc.js';
import { t } from '@lib/i18n.js';
import { npubDecode } from '@lib/crypto/bech32.js';
import { truncateNpub } from '@shared/format/text.js';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import Button from '@components/Button/Button';
import InputRow from '@components/InputRow/InputRow';
import RemoveButton from '@components/RemoveButton/RemoveButton';
import EmptyState from '@components/EmptyState/EmptyState';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import styles from './Filters.module.css';

interface FiltersModalProps {
  visible: boolean;
  onClose: () => void;
}

/** Server-returned grouped public mute list + preserved raw private content. */
interface MyMuteList {
  people: string[];
  hashtags: string[];
  words: string[];
  events: string[];
  rawContent: string;
  createdAt: number;
}

/**
 * Suggested public mute lists to one-tap import.
 *
 * NOTE (deliberately empty): the task called for a few CURRENT, reputable
 * well-known public Nostr mute-list pubkeys. Research (web search, June 2026)
 * did NOT surface any canonical "community spam / impersonator" mute-list npub
 * that could be verified with confidence. Importing the wrong pubkey would
 * pollute the user's own published mute list, so — per the instruction to
 * "include FEWER rather than guess" and "do not invent pubkeys" — no presets
 * are hardcoded. The "Import public list" input below lets the user paste any
 * pubkey whose public mute list they trust. If a verifiable list is identified
 * later, add `{ name, pubkey }` entries here.
 */
const SUGGESTED_LISTS: Array<{ name: string; pubkey: string }> = [];

/** Normalize an npub/hex pubkey input to lowercase hex, or null if invalid. */
function toHexPubkey(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (/^[0-9a-fA-F]{64}$/.test(v)) return v.toLowerCase();
  try {
    return npubDecode(v);
  } catch {
    return null;
  }
}

interface MuteGroupProps {
  label: string;
  hint: string;
  placeholder: string;
  items: string[];
  render?: (item: string) => string;
  validate?: (raw: string) => string | null; // returns normalized value or null if invalid
  invalidMsg?: string;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}

function MuteGroup({ label, hint, placeholder, items, render, validate, invalidMsg, onAdd, onRemove }: MuteGroupProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const handleAdd = () => {
    const raw = value.trim();
    if (!raw) return;
    const normalized = validate ? validate(raw) : raw;
    if (normalized === null) { setError(invalidMsg || t('mutes.invalidEntry')); return; }
    setError('');
    setValue('');
    onAdd(normalized);
  };

  return (
    <div className={styles.muteGroup}>
      <SectionLabel>{label}</SectionLabel>
      <div className={styles.blockList}>
        {items.map((item) => (
          <div key={item} className={styles.blockItem}>
            <span className={styles.blockPubkey} title={item}>{render ? render(item) : item}</span>
            <RemoveButton onClick={() => onRemove(item)} />
          </div>
        ))}
      </div>
      <InputRow
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { setValue(e.target.value); setError(''); }}
        placeholder={placeholder}
        onSubmit={handleAdd}
        buttonLabel={t('common.add')}
        error={error}
      />
      {items.length === 0 && <div className={styles.muteGroupHint}>{hint}</div>}
    </div>
  );
}

export default function FiltersModal({ visible, onClose }: FiltersModalProps) {
  const [list, setList] = useState<MyMuteList | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<'success' | 'error' | null>(null);

  const [importValue, setImportValue] = useState('');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);

  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setDirty(false);
    setPublishResult(null);
    (async () => {
      try {
        const data = await rpc<MyMuteList>('getMyMuteList');
        if (mounted.current && data) setList(data);
      } catch {
        if (mounted.current) setList({ people: [], hashtags: [], words: [], events: [], rawContent: '', createdAt: 0 });
      }
      if (mounted.current) setLoading(false);
    })();
  }, [visible]);

  if (!visible) return null;

  const cur: MyMuteList = list || { people: [], hashtags: [], words: [], events: [], rawContent: '', createdAt: 0 };

  const update = (patch: Partial<MyMuteList>) => {
    setList({ ...cur, ...patch });
    setDirty(true);
    setPublishResult(null);
  };

  const addUnique = (arr: string[], value: string) => (arr.includes(value) ? arr : [...arr, value]);

  const mergePeople = (incoming: string[]) => {
    const merged = [...cur.people];
    let added = 0;
    for (const pk of incoming) {
      if (pk && !merged.includes(pk)) { merged.push(pk); added++; }
    }
    if (added > 0) update({ people: merged });
    return added;
  };

  const handleImport = async () => {
    const hex = toHexPubkey(importValue);
    if (!hex) { setImportError(t('mutes.invalidPubkey')); return; }
    setImportError('');
    setImporting(true);
    try {
      const result = await rpc<{ ok?: boolean; people?: string[] }>('fetchMuteList', { pubkey: hex });
      const people = result?.people || [];
      if (people.length === 0) {
        setImportError(t('mutes.noMuteListFound'));
      } else {
        const added = mergePeople(people);
        setImportValue('');
        setImportError(added > 0 ? '' : t('mutes.nothingNew'));
      }
    } catch {
      setImportError(t('mutes.failedFetch'));
    }
    if (mounted.current) setImporting(false);
  };

  const handleSuggested = async (pubkey: string) => {
    setImporting(true);
    try {
      const result = await rpc<{ ok?: boolean; people?: string[] }>('fetchMuteList', { pubkey });
      mergePeople(result?.people || []);
    } catch { /* ignore */ }
    if (mounted.current) setImporting(false);
  };

  const handlePublish = async () => {
    setPublishing(true);
    setPublishResult(null);
    try {
      const result = await rpc<{ ok?: boolean; sent?: boolean }>('publishMuteList', {
        people: cur.people,
        hashtags: cur.hashtags,
        words: cur.words,
        events: cur.events,
        rawContent: cur.rawContent,
      });
      if (result?.sent) {
        setPublishResult('success');
        setDirty(false);
      } else {
        setPublishResult('error');
      }
    } catch {
      setPublishResult('error');
    }
    if (mounted.current) setPublishing(false);
    setTimeout(() => { if (mounted.current) setPublishResult(null); }, 3000);
  };

  return (
    <OverlayPanel title={t('mutes.title')} onBack={onClose}>
      <div className={styles.content}>
        {loading ? (
          <EmptyState text={t('common.loading')} />
        ) : (
          <>
            <MuteGroup
              label={t('mutes.people')}
              hint={t('mutes.peopleHint')}
              placeholder={t('mutes.peoplePlaceholder')}
              items={cur.people}
              render={(pk) => truncateNpub(pk)}
              validate={toHexPubkey}
              invalidMsg={t('mutes.invalidPubkey')}
              onAdd={(v) => update({ people: addUnique(cur.people, v) })}
              onRemove={(v) => update({ people: cur.people.filter((p) => p !== v) })}
            />

            <MuteGroup
              label={t('mutes.words')}
              hint={t('mutes.wordsHint')}
              placeholder={t('mutes.wordsPlaceholder')}
              items={cur.words}
              validate={(raw) => raw.toLowerCase()}
              onAdd={(v) => update({ words: addUnique(cur.words, v) })}
              onRemove={(v) => update({ words: cur.words.filter((w) => w !== v) })}
            />

            <MuteGroup
              label={t('mutes.hashtags')}
              hint={t('mutes.hashtagsHint')}
              placeholder={t('mutes.hashtagsPlaceholder')}
              items={cur.hashtags}
              validate={(raw) => raw.replace(/^#/, '').toLowerCase()}
              onAdd={(v) => update({ hashtags: addUnique(cur.hashtags, v) })}
              onRemove={(v) => update({ hashtags: cur.hashtags.filter((h) => h !== v) })}
            />

            <div className={styles.muteGroup}>
              <SectionLabel>{t('mutes.importTitle')}</SectionLabel>
              <InputRow
                value={importValue}
                onChange={(e: ChangeEvent<HTMLInputElement>) => { setImportValue(e.target.value); setImportError(''); }}
                placeholder={t('mutes.importPlaceholder')}
                onSubmit={handleImport}
                buttonLabel={importing ? t('common.fetching') : t('mutes.importButton')}
                disabled={importing}
                error={importError}
                mono
              />
              {SUGGESTED_LISTS.length > 0 && (
                <div className={styles.suggestedRow}>
                  {SUGGESTED_LISTS.map((s) => (
                    <Button key={s.pubkey} small variant="secondary" disabled={importing} onClick={() => handleSuggested(s.pubkey)}>
                      {s.name}
                    </Button>
                  ))}
                </div>
              )}
              <div className={styles.muteGroupHint}>{t('mutes.importHint')}</div>
            </div>

            <div className={styles.publishRow}>
              <span className={`${styles.publishInfo} ${dirty ? styles.publishUnsaved : ''} ${publishResult === 'success' ? styles.publishSuccess : ''} ${publishResult === 'error' ? styles.publishError : ''}`}>
                {publishing
                  ? t('common.publishing')
                  : publishResult === 'success'
                    ? t('mutes.published')
                    : publishResult === 'error'
                      ? t('mutes.publishFailed')
                      : dirty
                        ? t('mutes.unsaved')
                        : cur.createdAt > 0
                          ? t('mutes.published')
                          : t('mutes.notPublished')}
              </span>
              {publishing && <div className={styles.publishSpinner} />}
              <Button small variant="secondary" onClick={handlePublish} disabled={publishing}>{t('common.publish')}</Button>
            </div>
          </>
        )}
      </div>
    </OverlayPanel>
  );
}
