import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { truncateNpub } from '@utils/format/text.ts';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import Button from '@components/Button/Button';
import InputRow from '@components/InputRow/InputRow';
import EditableList from '@components/EditableList/EditableList';
import EmptyState from '@components/EmptyState/EmptyState';
import PublishRow from '@components/PublishRow/PublishRow';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import { muteListState, toHexPubkey, normalizeHashtag, type MyMuteList, type MuteListRead } from '@domain/mutes/muteList.ts';
import { useAccount } from '@context/AccountContext';
import IconButton from '@components/IconButton/IconButton';
import Modal from '@components/Modal/Modal';
import { IconInfo } from '@assets';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

interface FiltersOverlayProps {
  visible: boolean;
  onClose: () => void;
}

/** Server-returned grouped public mute list + preserved raw private content. */
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

const muteClassNames = {
  group: "flex flex-col gap-3",
  list: "flex flex-col gap-2",
  row: "flex items-center gap-4 py-4 px-6 border border-card-border bg-card rounded-panel",
  item: "flex-1 text-sm text-heading truncate min-w-0",
  hint: "text-xs text-muted leading-tight",
};

export default function FiltersOverlay({ visible, onClose }: FiltersOverlayProps) {
  const { active } = useAccount();
  const [showInfo, setShowInfo] = useState(false);
  const [list, setList] = useState<MyMuteList | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<'success' | 'error' | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [importValue, setImportValue] = useState('');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);

  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setList(null);
    setDirty(false);
    setPublishResult(null);
    setReadFailed(false);
    void (async () => {
      try {
        const data = await rpc<MuteListRead>('getMyMuteList', { fresh: true });
        if (cancelled) return;
        // A read no relay answered is not an empty mute list. Rendering it as
        // one produced an editable, apparently-empty list whose Publish replaced
        // the real kind:10000 — including every NIP-44-encrypted private mute,
        // which survives only by round-tripping the rawContent this read did not
        // get. Show the failure instead and let the user retry.
        if (!data || data.reachable === false) {
          setReadFailed(true);
        } else {
          setList(data);
        }
      } catch {
        if (!cancelled) setReadFailed(true);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [visible, reloadNonce, active?.id]);

  if (!visible) return null;

  const cur: MyMuteList = list || { people: [], hashtags: [], words: [], events: [], rawContent: '', createdAt: 0 };

  const readState = muteListState(list);

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
    if (importing || publishing || loading || readFailed) return;
    const hex = toHexPubkey(importValue);
    if (!hex) { setImportError(t('mutes.invalidPubkey')); return; }
    setImportError('');
    setImporting(true);
    try {
      const result = await rpc<MuteListRead & { ok?: boolean }>('fetchMuteList', { pubkey: hex });
      const people = result?.people || [];
      if (result?.reachable === false || result?.ok === false) {
        setImportError(t('mutes.failedFetch'));
      } else if (people.length === 0) {
        setImportError(result?.createdAt ? t('mutes.noPublicPeople') : t('mutes.noMuteListFound'));
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
      const result = await rpc<MuteListRead & { ok?: boolean }>('fetchMuteList', { pubkey });
      mergePeople(result?.people || []);
    } catch { /* ignore */ }
    if (mounted.current) setImporting(false);
  };

  const handlePublish = async () => {
    if (publishing || loading || readFailed || !list || !dirty) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      const result = await rpc<{ ok?: boolean; sent?: boolean }>('publishMuteList', {
        people: cur.people,
        hashtags: cur.hashtags,
        words: cur.words,
        events: cur.events,
        rawContent: cur.rawContent,
        // The background refuses without this: rawContent carries the user's
        // private mutes, and it is only trustworthy when a relay answered.
        readReachable: true,
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
    <OverlayPanel title={t('mutes.title')} onBack={onClose}
      headerRight={<IconButton size={36} aria-label={t('mutes.aboutTitle')} onClick={() => setShowInfo(true)}><IconInfo size={18} /></IconButton>}>
      {showInfo && <Modal title={t('mutes.aboutTitle')} onClose={() => setShowInfo(false)}
        footer={<Button onClick={() => setShowInfo(false)}>{t('common.gotIt')}</Button>}>
        <Text as="p" className="leading-normal">{t('mutes.aboutBody')}</Text>
      </Modal>}
      <Container className="flex-1 overflow-y-auto gap-8">
        {loading ? (
          <EmptyState text={t('common.loading')} />
        ) : readFailed ? (
          <EmptyState text={t('mutes.readFailed')}>
            <Button small onClick={() => { setLoading(true); setReadFailed(false); setReloadNonce((n) => n + 1); }}>
              {t('common.retry')}
            </Button>
          </EmptyState>
        ) : (
          <>
            {(readState === 'missing' || readState === 'empty' || readState === 'private') && (
              <div role="status" className="rounded-md border border-card-border bg-card px-6 py-5 text-sm text-secondary leading-normal">
                {readState === 'missing' ? t('mutes.ownListMissing') : readState === 'private' ? t('mutes.privateOnly') : t('mutes.emptyList')}
              </div>
            )}
            <EditableList
              label={t('mutes.people')}
              hint={t('mutes.peopleHint')}
              placeholder={t('mutes.peoplePlaceholder')}
              buttonLabel={t('common.add')}
              items={cur.people}
              classNames={muteClassNames}
              disabled={publishing}
              renderItem={(pk) => truncateNpub(pk)}
              validate={toHexPubkey}
              invalidMsg={t('mutes.invalidPubkey')}
              onAdd={(v) => update({ people: addUnique(cur.people, v) })}
              onRemove={(v) => update({ people: cur.people.filter((p) => p !== v) })}
            />

            <EditableList
              label={t('mutes.words')}
              hint={t('mutes.wordsHint')}
              placeholder={t('mutes.wordsPlaceholder')}
              buttonLabel={t('common.add')}
              items={cur.words}
              classNames={muteClassNames}
              disabled={publishing}
              validate={(raw) => raw.toLowerCase()}
              onAdd={(v) => update({ words: addUnique(cur.words, v) })}
              onRemove={(v) => update({ words: cur.words.filter((w) => w !== v) })}
            />

            <EditableList
              label={t('mutes.hashtags')}
              hint={t('mutes.hashtagsHint')}
              placeholder={t('mutes.hashtagsPlaceholder')}
              buttonLabel={t('common.add')}
              items={cur.hashtags}
              classNames={muteClassNames}
              disabled={publishing}
              validate={normalizeHashtag}
              onAdd={(v) => update({ hashtags: addUnique(cur.hashtags, v) })}
              onRemove={(v) => update({ hashtags: cur.hashtags.filter((h) => h !== v) })}
            />

            <Container gap={3}>
              <SectionLabel>{t('mutes.importTitle')}</SectionLabel>
              <InputRow
                value={importValue}
                onChange={(e: ChangeEvent<HTMLInputElement>) => { setImportValue(e.target.value); setImportError(''); }}
                placeholder={t('mutes.importPlaceholder')}
                onSubmit={handleImport}
                buttonLabel={importing ? t('common.fetching') : t('mutes.importButton')}
                disabled={importing || publishing || !toHexPubkey(importValue)}
                error={importError}
                mono
              />
              {SUGGESTED_LISTS.length > 0 && (
                <Container variant="row" gap={3} className="flex-wrap">
                  {SUGGESTED_LISTS.map((s) => (
                    <Button key={s.pubkey} small variant="secondary" disabled={importing} onClick={() => handleSuggested(s.pubkey)}>
                      {s.name}
                    </Button>
                  ))}
                </Container>
              )}
              <Text variant="muted" as="div" className="leading-tight">{t('mutes.importHint')}</Text>
            </Container>

            <PublishRow
              disabled={!dirty || importing}
              publishing={publishing}
              status={publishResult}
              dirty={dirty}
              labels={{
                idle: cur.createdAt > 0 ? t('mutes.published') : t('mutes.notPublished'),
                unsaved: t('mutes.unsaved'),
                success: t('mutes.published'),
                error: t('mutes.publishFailed'),
                publishing: t('common.publishing'),
              }}
              onPublish={handlePublish}
            />
          </>
        )}
      </Container>
    </OverlayPanel>
  );
}
