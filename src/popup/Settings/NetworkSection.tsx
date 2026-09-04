import React, { useState, useEffect, useRef, ChangeEvent } from 'react';
import browser from '@shared/browser.ts';
import { rpc } from '@shared/rpc.ts';
import { t } from '@lib/i18n.js';
import { formatTimeAgo } from '@shared/format/time.ts';
import { isValidWssUrl } from '@shared/url.ts';
import StatusDot from '@components/StatusDot/StatusDot';
import EditableList from '@components/EditableList/EditableList';
import PublishRow from '@components/PublishRow/PublishRow';
import { SectionLabel } from '@components/SectionLabel/SectionLabel';
import { useRelays, type RelayFlags } from '@popup/context/RelaysContext';
import styles from './Settings.module.css';

export default function NetworkSection() {
  const { relays, relayFlags, loaded, saveRelays } = useRelays();
  const [relayHealth, setRelayHealth] = useState<Record<string, string>>({});
  const [newRelay, setNewRelay] = useState<string>('');
  const [relayError, setRelayError] = useState<string>('');

  const [lastPublish, setLastPublish] = useState<number | null>(null);
  const [publishUnsaved, setPublishUnsaved] = useState<boolean>(false);
  const [publishing, setPublishing] = useState<boolean>(false);
  const [publishResult, setPublishResult] = useState<'success' | 'error' | null>(null);

  const mounted = useRef<boolean>(true);
  useEffect(() => { return () => { mounted.current = false; }; }, []);

  // Runs once, the first time RelaysContext has real data — not on every
  // `relays` identity change, since the health check and the "did the list
  // change since the last publish" comparison are both one-shot, mount-time
  // questions, not something to redo every time the list is edited.
  const initedRef = useRef<boolean>(false);
  useEffect(() => {
    if (!loaded || initedRef.current) return;
    initedRef.current = true;
    (async () => {
      const localData: any = await browser.storage.local.get(['lastRelayPublish', 'lastPublishedRelays']);
      const relayStr = relays.join(',');

      if (localData.lastRelayPublish) {
        setLastPublish(localData.lastRelayPublish);
      }
      if (localData.lastPublishedRelays && localData.lastPublishedRelays !== relayStr) {
        setPublishUnsaved(true);
      }

      for (const url of relays) checkRelay(url);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

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
    saveRelays(updated, relayFlags);
    checkRelay(url);
  };

  const removeRelay = (url: string) => {
    const updated = relays.filter((r) => r !== url);
    const newFlags = { ...relayFlags };
    delete newFlags[url];
    saveRelays(updated, newFlags);
  };

  const toggleRelayFlag = (url: string, flag: 'read' | 'write') => {
    const current = relayFlags[url] || { read: true, write: true };
    const newFlags = { ...relayFlags, [url]: { ...current, [flag]: !current[flag] } };
    saveRelays(relays, newFlags);
  };

  const publishRelayList = async () => {
    setPublishing(true);
    setPublishResult(null);
    try {
      const result = await rpc<{ sent?: boolean }>('publishRelayList');
      if (result?.sent) {
        setLastPublish(Date.now());
        setPublishUnsaved(false);
        setPublishResult('success');
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
    <div className={styles.section}>
      <SectionLabel>{t('network.identityRelays')}</SectionLabel>
      <EditableList
        items={relays}
        classNames={{ list: styles.relayList, row: styles.relayRow, item: styles.relayUrl }}
        renderItem={(url) => url.replace(/^wss:\/\/|^https:\/\//, '')}
        leading={(url) => <StatusDot status={relayHealth[url]} />}
        trailing={(url) => {
          const flags = relayFlags[url] || { read: true, write: true };
          return (
            <div className={styles.relayChips}>
              <button
                className={`${styles.relayChip} ${flags.read ? styles.relayChipActive : ''}`}
                onClick={() => toggleRelayFlag(url, 'read')}
              >R</button>
              <button
                className={`${styles.relayChip} ${flags.write ? styles.relayChipActive : ''}`}
                onClick={() => toggleRelayFlag(url, 'write')}
              >W</button>
            </div>
          );
        }}
        placeholder={t('network.relayPlaceholder')}
        buttonLabel={t('common.add')}
        onRemove={removeRelay}
        mono
        inputValue={newRelay}
        onInputChange={(e: ChangeEvent<HTMLInputElement>) => { setNewRelay(e.target.value); setRelayError(''); }}
        onAdd={addRelay}
        error={relayError}
      />

      <PublishRow
        publishing={publishing}
        status={publishResult}
        dirty={publishUnsaved}
        labels={{
          idle: lastPublish
            ? t('network.lastPublished', { time: formatTimeAgo(lastPublish) })
            : t('network.notPublishedYet'),
          unsaved: t('network.relayListChanged'),
          success: t('network.relayListPublished'),
          error: t('network.relayListFailed'),
          publishing: t('common.publishing'),
        }}
        onPublish={publishRelayList}
      />
    </div>
  );
}
