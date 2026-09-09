import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { useAccount } from '@context/AccountContext';
import Button from '@components/Button/Button';
import { configuredRelayUrls, parseRelayList, sameRelayList, type RelayConfiguration } from '@domain/relays/relayList';
import type { RelayListRead } from '@services/background/relay-list-handlers.ts';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { formatTimeAgo } from '@utils/format/time.ts';
import { isValidWssUrl } from '@utils/url.ts';
import StatusDot from '@components/StatusDot/StatusDot';
import EditableList from '@components/EditableList/EditableList';
import PublishRow from '@components/PublishRow/PublishRow';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import { useRelays } from '@context/RelaysContext';
import Container from '@components/Container/Container';

export default function NetworkSection() {
  const { relays, relayFlags, loaded, previousConfiguration, saveRelays } = useRelays();
  const [relayHealth, setRelayHealth] = useState<Record<string, string>>({});
  const [newRelay, setNewRelay] = useState<string>('');
  const [relayError, setRelayError] = useState<string>('');

  const { active } = useAccount();
  const [remote, setRemote] = useState<RelayListRead | null>(null);
  const [checking, setChecking] = useState(true);
  const [revision, setRevision] = useState(0);
  const [lastPublish, setLastPublish] = useState<number | null>(null);
  const [publishUnsaved, setPublishUnsaved] = useState<boolean>(false);
  const [publishing, setPublishing] = useState<boolean>(false);
  const [publishResult, setPublishResult] = useState<'success' | 'error' | null>(null);

  const mounted = useRef<boolean>(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    let cancelled = false;
    if (!active?.pubkey) return;
    setChecking(true);
    setRemote(null);
    setLastPublish(null);
    setPublishUnsaved(false);
    void rpc<RelayListRead>('getMyRelayList').then(result => {
      if (cancelled || result.pubkey !== active?.pubkey) return;
      setRemote(result);
      setLastPublish(result.event ? result.event.created_at * 1000 : null);
    }).catch(() => {}).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [active?.pubkey, revision]);

  const initedRef = useRef(false);
  useEffect(() => {
    if (!loaded || initedRef.current) return;
    initedRef.current = true;
    for (const url of relays) void checkRelay(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const published = remote?.event ? parseRelayList(remote.event.tags) : null;
  const differs = !!published && !sameRelayList({ relays, flags: relayFlags }, published);

  const checkRelay = async (url: string) => {
    setRelayHealth((h) => ({ ...h, [url]: 'checking' }));
    try {
      const result = await rpc<{ reachable?: boolean }>('checkRelayHealth', { url });
      if (mounted.current) setRelayHealth((h) => ({ ...h, [url]: result?.reachable ? 'reachable' : 'unreachable' }));
    } catch {
      if (mounted.current) setRelayHealth((h) => ({ ...h, [url]: 'unreachable' }));
    }
  };

  const addRelay = () => {
    const url = newRelay.trim();
    if (!url) return;
    if (!isValidWssUrl(url)) { setRelayError(t('network.mustBeWss')); return; }
    if (relays.includes(url)) { setRelayError(t('network.relayAlreadyAdded')); return; }
    const updated = [...relays, url];
    setNewRelay('');
    setRelayError('');
    setPublishUnsaved(true);
    void saveRelays(updated, relayFlags);
    void checkRelay(url);
  };

  const removeRelay = (url: string) => {
    const updated = relays.filter((r) => r !== url);
    const newFlags = { ...relayFlags };
    delete newFlags[url];
    setPublishUnsaved(true);
    void saveRelays(updated, newFlags);
  };

  const toggleRelayFlag = (url: string, flag: 'read' | 'write') => {
    const current = relayFlags[url] || { read: true, write: true };
    const newFlags = { ...relayFlags, [url]: { ...current, [flag]: !current[flag] } };
    setPublishUnsaved(true);
    void saveRelays(relays, newFlags);
  };

  const publishRelayList = async () => {
    setPublishing(true);
    setPublishResult(null);
    try {
      const result = await rpc<{ sent?: number }>('publishRelayList', {configuration:{relays,flags:relayFlags},pubkey:active?.pubkey});
      if (result?.sent) {
        setLastPublish(Date.now());
        setPublishUnsaved(false);
        setPublishResult('success');
        setRevision(n => n + 1);
      } else {
        setPublishResult('error');
      }
    } catch {
      setPublishResult('error');
    }
    setPublishing(false);
    setTimeout(() => setPublishResult(null), 3000);
  };

  return (
    <Container gap={4} className="flex-1 min-h-0 overflow-y-auto py-2">
      <PublishedRelayConfiguration result={remote} checking={checking} local={{relays,flags:relayFlags}} disabled={!loaded || publishing}
        onApply={configuration => { void saveRelays(configuration.relays, configuration.flags).then(() => setPublishUnsaved(false)).catch(() => setRelayError(t('common.error'))); }}
        onRetry={() => setRevision(n => n + 1)} />
      <SectionLabel>{t('network.localConfiguration')}</SectionLabel>
      {loaded && (previousConfiguration || !relays.length) && <Button small variant="secondary" disabled={publishing} onClick={() => {
        const restored = previousConfiguration || {relays:configuredRelayUrls(undefined),flags:{}};
        void saveRelays(restored.relays, restored.flags).then(() => setPublishUnsaved(true)).catch(() => setRelayError(t('common.error')));
      }}>{t(previousConfiguration ? 'network.restorePrevious' : 'network.restoreDefaults')}</Button>}
      <EditableList
        items={relays}
        classNames={{
          list: 'flex flex-col gap-2',
          row: 'flex items-center gap-4 py-4 px-6 border border-card-border bg-card rounded-panel',
          item: 'flex-1 text-sm font-medium text-heading min-w-0 overflow-hidden text-ellipsis whitespace-nowrap',
        }}
        renderItem={(url) => url.replace(/^wss:\/\/|^https:\/\//, '')}
        leading={(url) => <StatusDot status={relayHealth[url]} />}
        trailing={(url) => {
          const flags = relayFlags[url] || { read: true, write: true };
          // Not <Chip>: these badges sit inside an already-compact relay row and
          // need a tighter scale than Chip owns (2xs font, sp-1/sp-4 padding vs
          // Chip's xs/sp-2/sp-5) — the one caller SeedWord's `compact` prop
          // solved for. A single relay row is not a second caller yet.
          return (
            <Container variant="row" gap={2}>
              <button
                className={`py-1 px-4 rounded-sm text-2xs font-semibold border cursor-pointer transition-all ${
                  flags.read ? 'bg-brand-light text-brand border-[rgb(99_102_241_/_0.2)]' : 'border-card-border bg-transparent text-muted'
                }`}
                onClick={() => toggleRelayFlag(url, 'read')}
              >R</button>
              <button
                className={`py-1 px-4 rounded-sm text-2xs font-semibold border cursor-pointer transition-all ${
                  flags.write ? 'bg-brand-light text-brand border-[rgb(99_102_241_/_0.2)]' : 'border-card-border bg-transparent text-muted'
                }`}
                onClick={() => toggleRelayFlag(url, 'write')}
              >W</button>
            </Container>
          );
        }}
        placeholder={t('network.relayPlaceholder')}
        buttonLabel={t('common.add')}
        onRemove={removeRelay}
        mono
        inputValue={newRelay}
        onInputChange={(e: ChangeEvent<HTMLInputElement>) => { setNewRelay(e.target.value); setRelayError(''); }}
        onAdd={addRelay}
        validate={(raw) => isValidWssUrl(raw) ? raw : null}
        error={relayError || (newRelay.trim() && !isValidWssUrl(newRelay.trim()) ? t('network.mustBeWss') : '')}
      />

      <PublishRow
        publishing={publishing}
        status={publishResult}
        dirty={publishUnsaved || differs}
        disabled={!loaded || checking || !relays.some(url => { const flags = relayFlags[url]; return !flags || flags.read || flags.write; }) || (!remote?.event && !remote?.reachable)}
        labels={{
          idle: lastPublish
            ? t('network.lastPublished', { time: formatTimeAgo(lastPublish) })
            : t(checking ? 'network.checkingPublished' : remote?.reachable ? 'network.noPublishedEvent' : 'network.publishedUnavailable'),
          unsaved: t('network.relayListChanged'),
          success: t('network.relayListPublished'),
          error: t('network.relayListFailed'),
          publishing: t('common.publishing'),
        }}
        onPublish={publishRelayList}
      />
    </Container>
  );
}

export function PublishedRelayConfiguration({result, checking, local, disabled, onApply, onRetry}: {
  result: RelayListRead | null;
  checking: boolean;
  local: RelayConfiguration;
  disabled: boolean;
  onApply: (configuration: RelayConfiguration) => void;
  onRetry: () => void;
}) {
  const published = result?.event ? parseRelayList(result.event.tags) : null;
  const differs = !!published && !sameRelayList(local, published);
  return (
      <div className="shrink-0 rounded-panel border border-card-border bg-input p-5 text-xs text-secondary">
        <p className="font-semibold text-heading">{t('network.publishedConfiguration')}</p>
        <p className="mt-2">{t(checking ? 'network.checkingPublished' : result?.event ? (published?.relays.length ? 'network.publishedFound' : 'network.publishedEmpty') : result?.reachable ? 'network.noPublishedEvent' : 'network.publishedUnavailable')}</p>
        {published && <ul className="my-3 space-y-2">{published.relays.map(url => <li key={url} className="flex justify-between gap-3"><span className="break-all">{url}</span><span className="shrink-0">{published.flags[url].read ? 'R' : ''}{published.flags[url].write ? 'W' : ''}</span></li>)}</ul>}
        {differs && <Button small variant="secondary" disabled={disabled || !published?.relays.length} onClick={() => { if (published?.relays.length) { onApply(published); } }}>{t('network.usePublished')}</Button>}
        <Button small variant="secondary" disabled={checking} onClick={onRetry}>{t('network.checkAgain')}</Button>
      </div>
  );
}
