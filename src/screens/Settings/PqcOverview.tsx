import { t } from '@services/i18n/i18n.ts';
import { IconKey, IconDownload, IconWarning, IconGlobe } from '@assets';
import Button from '@components/Button/Button';
import ListRow from '@components/ListRow/ListRow';
import StatusDot from '@components/StatusDot/StatusDot';
import StatusNotice from '@components/StatusNotice/StatusNotice';
import Text from '@components/Text/Text';
import type { PqcPublished } from '@domain/pqc/pqcState.ts';

export default function PqcOverview({ imported, ready, removing, onKeys, onExport, onAnnouncement, onRemove }: {
  imported: boolean; ready: boolean; removing: boolean;
  onKeys: () => void; onExport: () => void; onAnnouncement: () => void; onRemove: () => void;
}) {
  return <div className="flex flex-col gap-7">
    <div className="flex items-start gap-5">
      <div className="flex flex-col gap-3 min-w-0">
        <h3 className="m-0 text-xl text-heading font-semibold">{imported ? t('pqc.importedTitle') : t('pqc.readyTitle')}</h3>
        <Text variant="secondary" className="text-sm leading-loose">{imported ? t('pqc.importedDesc') : t('pqc.readyDesc')}</Text>
      </div>
    </div>
    <div className="rounded-panel border border-card-border overflow-hidden">
      <ListRow leading={<IconKey size={18} />} title={t('pqc.showKeys')} onClick={onKeys} />
      <ListRow leading={<IconDownload size={18} />} title={t('pqc.exportKeys')} onClick={onExport} />
      <ListRow leading={<IconGlobe size={18} />} title={t('pqc.publicationTitle')} onClick={onAnnouncement}
        trailing={<StatusDot status={ready ? 'approved' : 'rejected'} />} />
    </div>
    <Text variant="secondary" className="text-sm leading-loose">{t('pqc.protectionSummary')}</Text>
    {imported && <>
      <StatusNotice variant="callout" tone="warn" icon={<IconWarning size={18} />}>{t('pqc.importedBackupWarning')}</StatusNotice>
      <Button variant="danger" outline small onClick={onRemove} disabled={removing}>{t('pqc.importRemove')}</Button>
    </>}
  </div>;
}

/** Publication details are opened from the announcement row. */
export function PqcPublication({ ready, existing, busy, onPublish, onRetry }: {
  ready: boolean; existing: PqcPublished | null | undefined;
  busy: boolean; onPublish: () => void; onRetry: () => void;
}) {
  return <div className="flex flex-col gap-5">
    <Text variant="secondary" className="text-sm leading-loose">
      {ready ? t('pqc.alreadyPublished') : existing?.unreachable ? t('pqc.checkFailed') : existing?.published && !existing.current ? t('pqc.staleAttestation') : t('pqc.publishDesc')}
    </Text>
    {!ready && <div className="flex gap-4">
      <Button className="flex-1" onClick={onPublish} disabled={busy}>{busy ? t('pqc.publishing') : t('pqc.publish')}</Button>
      {existing?.unreachable && <Button variant="secondary" onClick={onRetry} disabled={busy}>{t('common.retry')}</Button>}
    </div>}
  </div>;
}
