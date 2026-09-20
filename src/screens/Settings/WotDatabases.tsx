import { useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { formatBytes } from '@utils/format/bytes.ts';
import { truncateNpub } from '@domain/nostr/display.ts';
import type { WotDatabaseSummary, WotSyncProgress } from '@domain/wot/types.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import Card from '@components/Card';
import Container from '@components/Container';
import Text from '@components/Text';
import FormError from '@components/FormError';
import IconButton from '@components/IconButton';
import InfoTooltip from '@components/InfoTooltip';
import RemoveButton from '@components/RemoveButton';
import ConfirmDialog from '@components/ConfirmDialog';
import IconSync from '@assets/IconSync';
import { SectionLabel } from '@components/SectionLabel';
import WotSyncStatus from './WotSyncStatus';

export default function WotDatabases({ revision, progress, disabled = false, canSync = false }: {
    revision?: number | null; progress?: WotSyncProgress | null; disabled?: boolean; canSync?: boolean;
}) {
    const [removing, setRemoving] = useState<{name: string; accountId?: string} | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const resource = useAsyncResource<WotDatabaseSummary>({ databases: [], accounts: 0, bytes: 0, estimated: false }, { load: async (patch, isCurrent) => {
        const result = await rpc<WotDatabaseSummary>('experimentalWot_getDatabases');
        if (isCurrent()) patch(result);
    }, deps: [revision, progress?.accountId, progress?.running] });
    async function action(method: 'experimentalWot_sync' | 'experimentalWot_clear' | 'experimentalWot_clearCache', accountId?: string) {
        setBusy(true); setError('');
        try {
            await rpc(method, { accountId });
            setRemoving(null);
            await resource.refresh();
        } catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
    }
    return <>
        <Card><Container gap={4}>
            <Container variant="row" gap={4} className="justify-between">
                <SectionLabel>{t('wot.databases')}</SectionLabel>
                <IconButton aria-label={t('common.refresh')} title={t('common.refresh')} disabled={resource.loading || busy} onClick={() => { void resource.refresh(); }}><IconSync/></IconButton>
            </Container>
            {resource.loading && <Text variant="hint">{t('common.loading')}</Text>}
            <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse text-left">
                    <thead><tr className="text-secondary">
                        <th scope="col" className="py-3">{t('wot.databaseAccount')}</th>
                        <th scope="col" className="p-3">{t('wot.databaseStatus')}</th>
                        <th scope="col" className="py-3">{t('wot.databaseActions')}</th>
                    </tr></thead>
                    <tbody>{resource.data.databases.map(database => <tr key={database.accountId} className="border-t border-card-border">
                        <td className="py-3 align-top">
                            <Text className="break-all">{database.name}</Text>
                            {database.name !== truncateNpub(database.pubkey) && <Text variant="hint" mono>{truncateNpub(database.pubkey)}</Text>}
                            <Text variant="hint">≈ {formatBytes(database.bytes)}</Text>
                        </td>
                        <td className="p-3 align-top"><WotSyncStatus hasGraph incomplete={database.truncated || database.missingFollowLists > 0} progress={progress?.accountId === database.accountId ? progress : null}/></td>
                        <td className="py-3 align-top"><Container variant="row" gap={2}>
                            <IconButton aria-label={t('wot.resync') + ': ' + database.name} title={t('wot.resync')} disabled={disabled || busy || !canSync || !database.canSync} onClick={() => { void action('experimentalWot_sync', database.accountId); }}><IconSync/></IconButton>
                            <RemoveButton aria-label={t('common.remove') + ': ' + database.name} title={t('common.remove')} disabled={disabled || busy} onClick={() => { setError(''); setRemoving(database); }}/>
                        </Container></td>
                    </tr>)}
                    {!!resource.data.sharedCache?.records && <tr className="border-t border-card-border">
                        <td className="py-3 align-top">
                            <Text>{t('wot.sharedCache')}</Text>
                            <Text variant="hint">≈ {formatBytes(resource.data.sharedCache.bytes)}</Text>
                            <InfoTooltip text={t('wot.sharedCacheActionsHint')}/>
                        </td>
                        <td className="p-3 align-top"><WotSyncStatus hasGraph/><Text variant="hint">{resource.data.sharedCache.records.toLocaleString()} {t('wot.localGraph')}</Text></td>
                        <td className="py-3 align-top"><Container variant="row" gap={2}>
                            <IconButton aria-label={t('wot.resync') + ': ' + t('wot.sharedCache')} title={t('wot.resync')} disabled={disabled || busy || !canSync} onClick={() => { void action('experimentalWot_sync'); }}><IconSync/></IconButton>
                            <RemoveButton aria-label={t('common.remove') + ': ' + t('wot.sharedCache')} title={t('common.remove')} disabled={disabled || busy} onClick={() => { setError(''); setRemoving({name: t('wot.sharedCache')}); }}/>
                        </Container></td>
                    </tr>}
                    </tbody>
                </table>
            </div>
            {!resource.loading && !resource.data.databases.length && !resource.data.sharedCache?.records && <Text variant="secondary">{t('wot.notSynced')}</Text>}
            <Text variant="hint">{t('wot.storageUsed')}: ≈ {formatBytes(resource.data.bytes + (resource.data.sharedCache?.bytes ?? 0))}</Text>

            <FormError>{resource.error || (!removing ? error : '')}</FormError>
        </Container></Card>
        {removing && <ConfirmDialog title={t('wot.clear')} message={<>{removing.name}<Text>{t(removing.accountId ? 'wot.deleteDatabaseHint' : 'wot.deleteCacheHint')}</Text></>} confirmLabel={t('common.remove')} busy={busy} error={error} onCancel={() => setRemoving(null)} onConfirm={() => { void action(removing.accountId ? 'experimentalWot_clear' : 'experimentalWot_clearCache', removing.accountId); }}/>}
    </>;
}
