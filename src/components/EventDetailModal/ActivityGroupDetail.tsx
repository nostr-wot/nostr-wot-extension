import { useState } from 'react';
import { t } from '@lib/i18n.js';
import { activityEncryption, type ActivityEntry } from '@domain/activity/activity.ts';
import { KIND_LABELS } from '@domain/nostr/kindLabels.ts';
import { formatPermissionLabel } from '@domain/permissions/permissionLabels.ts';
import { truncate, truncateMiddle } from '@utils/format/text.ts';
import FieldDisplay from '@components/FieldDisplay/FieldDisplay';
import ListRow from '@components/ListRow/ListRow';
import Modal from '@components/Modal/Modal';
import Button from '@components/Button/Button';
import StatusDot from '@components/StatusDot/StatusDot';
import ActivityEntryDetail from './ActivityEntryDetail';

/** Small, kind-specific preview; ciphertext is never used as a row preview. */
export function activityRowPreview(entry: ActivityEntry): string {
  if (activityEncryption(entry) || /^(nip04|nip44)/.test(entry.method)) return t('activity.detail.encrypted');
  const event = entry.event;
  if (!event) return formatPermissionLabel(entry.method);
  if (event.kind === 0) {
    try {
      const profile = JSON.parse(event.content || '{}');
      const text = [profile.display_name, profile.name, profile.about].filter(value => typeof value === 'string').join(' · ');
      if (text) return truncate(text, 100);
    } catch { /* Malformed metadata remains available in the JSON dialog. */ }
  }
  if ([3, 5, 10000, 10002].includes(event.kind ?? -1)) {
    return (event.tags || []).slice(0, 3).map(tag => `${tag[0]}: ${truncateMiddle(tag[1], 18, 8)}`).join(' · ') || t('event.tags', { count: 0 });
  }
  return truncate(event.content?.replace(/\s+/g, ' '), 100) ||
    (event.tags || []).slice(0, 3).map(tag => `${tag[0]}: ${truncateMiddle(tag[1], 18, 8)}`).join(' · ') || formatPermissionLabel(entry.method, event);
}

export function ActivityItemDialog({ entry, onClose }: { entry: ActivityEntry; onClose: () => void }) {
  return <Modal title={formatPermissionLabel(entry.method, entry.event ?? undefined)} onClose={onClose} maxWidth={360}
    footer={<Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>}>
    <ActivityEntryDetail entry={entry} />
    {!entry.event && <details className="mt-5 text-xs text-secondary">
      <summary className="cursor-pointer font-semibold py-3">JSON</summary>
      <pre className="whitespace-pre-wrap break-all select-text">{JSON.stringify(entry.event || entry, null, 2)}</pre>
    </details>}
  </Modal>;
}

/** Shared metadata stays above a compact list; only a selected item mounts its details. */
export default function ActivityGroupDetail({ entries, selectedAccountPubkey }: { entries: ActivityEntry[]; selectedAccountPubkey?: string }) {
  const [selected, setSelected] = useState<ActivityEntry | null>(null);
  const first = entries[0];
  if (!first) return null;
  const account = first.pubkey && entries.every(entry => entry.pubkey === first.pubkey) ? first.pubkey : null;
  const peers = entries.map(entry => entry.theirPubkey || activityEncryption(entry)?.peerPubkey);
  const peer = peers[0] && peers.every(value => value === peers[0]) ? peers[0] : null;
  const kind = first.event?.kind ?? first.kind;
  const sharedKind = kind != null && entries.every(entry => (entry.event?.kind ?? entry.kind) === kind);
  const sharedDecision = entries.every(entry => entry.decision === first.decision);
  const decision = first.decision === 'approved' || first.decision === 'allow' ? 'allowed'
    : first.decision === 'rejected' || first.decision === 'deny' ? 'rejected' : first.decision === 'blocked' ? 'blocked' : 'pending';
  const dates = entries.map(entry => entry.timestamp);
  const start = new Date(Math.min(...dates));
  const end = new Date(Math.max(...dates));
  const time = start.toLocaleString([], {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const sameMinute = Math.floor(start.getTime() / 60000) === Math.floor(end.getTime() / 60000);
  return <div className="flex flex-col flex-1 min-h-0 gap-5">
    <div className="shrink-0 rounded-md bg-input px-5 py-3">
      <FieldDisplay label={t('activity.detail.time')} value={sameMinute ? time : `${time} – ${end.toLocaleString()}`} />
      {sharedKind && <FieldDisplay label={t('event.kind')} value={`${kind} · ${KIND_LABELS[kind] || formatPermissionLabel(first.method, first.event ?? undefined)}`} />}
      {account && account !== selectedAccountPubkey && <FieldDisplay label={t('activity.detail.account')} mono value={<span title={account}>{truncateMiddle(account)}</span>} />}
      {peer && <FieldDisplay label={t('activity.detail.peer')} mono value={<span title={peer}>{truncateMiddle(peer)}</span>} />}
      {sharedDecision && <FieldDisplay label={t('activity.detail.status')} value={<span className="inline-flex items-center gap-3">{t(`activity.${decision}`)}<StatusDot status={first.decision} /></span>} />}
    </div>
    <div className="text-xs text-secondary shrink-0">{t('activity.requests', { count: entries.length })}</div>
    <ol className="flex flex-col list-none m-0 p-0 min-h-0 overflow-y-auto overscroll-contain rounded-md border border-card-border">
      {entries.map((entry, i) => <li key={i} className="border-b border-card-border last:border-b-0">
        <ListRow leading={<span className="text-xs text-muted tabular-nums">{i + 1}</span>} leadingChip={false} title={activityRowPreview(entry)} subtitle={<span className="flex flex-wrap gap-3">
          <span>{formatPermissionLabel(entry.method, entry.event ?? undefined)}</span>
          {!!entry.event?.tags?.length && <span>{t('event.tags', {count:entry.event.tags.length})}</span>}
          {!account && entry.pubkey && <span title={entry.pubkey}>{t('activity.detail.account')}: {truncateMiddle(entry.pubkey)}</span>}
          {!peer && peers[i] && <span title={peers[i] ?? undefined}>{t('activity.detail.peer')}: {truncateMiddle(peers[i])}</span>}
          {!sharedDecision && <StatusDot status={entry.decision} />}
        </span>} onClick={() => setSelected(entry)} />
      </li>)}
    </ol>
    {selected && <ActivityItemDialog entry={selected} onClose={() => setSelected(null)} />}
  </div>;
}
