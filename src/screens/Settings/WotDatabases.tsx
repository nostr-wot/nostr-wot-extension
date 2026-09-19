import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import { formatBytes } from '@utils/format/bytes.ts';
import type { WotDatabaseSummary } from '@domain/wot/types.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import Card from '@components/Card';
import Container from '@components/Container';
import FieldDisplay from '@components/FieldDisplay';
import Text from '@components/Text';
import FormError from '@components/FormError';
import { ButtonSecondary } from '@components/Button';
import { SectionLabel } from '@components/SectionLabel';

export default function WotDatabases({ revision }: { revision?: number | null }) {
    const resource = useAsyncResource<WotDatabaseSummary>({ databases: [], accounts: 0, bytes: 0, estimated: false }, { load: async (patch, isCurrent) => {
        const result = await rpc<WotDatabaseSummary>('experimentalWot_getDatabases');
        if (isCurrent()) patch(result);
    }, deps: [revision] });
    return <Card><Container gap={4}>
        <SectionLabel>{t('wot.databases')}</SectionLabel>
        <Text variant="secondary">{t('wot.databaseHint')}</Text>
        <FieldDisplay label={t('wot.databaseCount')} value={String(resource.data.databases.length)}/>
        <FieldDisplay label={t('wot.accountCount')} value={String(resource.data.accounts)}/>
        <FieldDisplay label={t('wot.storageUsed')} value={`${resource.data.estimated ? '≈ ' : ''}${formatBytes(resource.data.bytes)}`}/>
        {resource.data.databases.map(database => <Container key={database.accountId} variant="box" gap={2}>
            <Text>{database.name}</Text>
            <FieldDisplay label={t('wot.storageUsed')} value={`${database.estimated ? '≈ ' : ''}${formatBytes(database.bytes)}`}/>
            <FieldDisplay label={t('wot.people')} value={String(database.people)}/>
            <FieldDisplay label={t('wot.localGraph')} value={String(database.authors)}/>
        </Container>)}
        {!!resource.data.sharedCache?.records && <Container variant="box" gap={2}>
            <Text>{t('wot.sharedCache')}</Text>
            <FieldDisplay label={t('wot.localGraph')} value={String(resource.data.sharedCache.records)}/>
            <FieldDisplay label={t('wot.storageUsed')} value={`≈ ${formatBytes(resource.data.sharedCache.bytes)}`}/>
        </Container>}
        <FormError>{resource.error}</FormError>
        <ButtonSecondary disabled={resource.loading} onClick={() => { void resource.refresh(); }}>{t('common.refresh')}</ButtonSecondary>
    </Container></Card>;
}
