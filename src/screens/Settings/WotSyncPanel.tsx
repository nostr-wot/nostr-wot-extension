import type { WotState } from '@domain/wot/types.ts';
import { t } from '@services/i18n/i18n.ts';
import { formatTimeAgo } from '@services/i18n/timeLabels.ts';
import Card from '@components/Card';
import Container from '@components/Container';
import Text from '@components/Text';
import Toggle from '@components/Toggle';
import FieldDisplay from '@components/FieldDisplay';
import FormError from '@components/FormError';
import StatusNotice from '@components/StatusNotice';
import IconWarning from '@assets/IconWarning';
import { ButtonSecondary } from '@components/Button';

export default function WotSyncPanel({ state, autoSync, onAutoSync, busy, onSettings }: {
    state: WotState; autoSync: boolean; onAutoSync: (value: boolean) => void;
    busy: boolean; onSettings?: () => void;
}) {
    const progress = state.progress;
    return <Card><Container gap={4}>
        <Container variant="row" gap={4}>
            <Text className="flex-1">{t('wot.autoSync')}</Text>
            <Toggle aria-label={t('wot.autoSync')} checked={autoSync} disabled={busy} onChange={onAutoSync}/>
        </Container>
        <Text variant="secondary">{t('wot.autoSyncHint')}</Text>
        {progress && <Container variant="box" gap={2} role="status" aria-live="polite">
            <Text>{state.syncing ? t('wot.syncing') : progress.phase === 'complete' ? t('wot.syncComplete') : t('wot.syncStopped')}</Text>
            <FieldDisplay label={t('wot.currentHop')} value={String(progress.depth)}/>
            <FieldDisplay label={t('wot.checkedAuthors')} value={String(progress.authors)}/>
            <FieldDisplay label={t('wot.localGraph')} value={String(progress.lists)}/>
            <FieldDisplay label={t('wot.people')} value={String(progress.people)}/>
            <FormError>{progress.error}</FormError>
        </Container>}
        <FieldDisplay label={t('wot.people')} value={state.hasLocalGraph ? String(state.people ?? 0) : t('wot.notSynced')}/>
        <FieldDisplay label={t('wot.localGraph')} value={state.hasLocalGraph ? String(state.authors) : t('wot.notSynced')}/>
        {state.updatedAt && <FieldDisplay label={t('wot.updated')} value={formatTimeAgo(state.updatedAt)}/>}
        {!!state.missingFollowLists && <Text variant="secondary">{t('wot.missingLists')}: {state.missingFollowLists}</Text>}
        {state.truncated && <Text variant="secondary">{t('wot.partial')}</Text>}
        {state.settings.enabled && state.muteStatus !== 'ready' && <StatusNotice variant="callout" tone="warn" icon={<IconWarning />}>{t(state.muteStatus === 'private-unavailable' ? 'wot.privateMutesUnavailable' : 'wot.mutesUnavailable')}</StatusNotice>}
        {onSettings && <ButtonSecondary onClick={onSettings}>{t('wot.syncSettings')}</ButtonSecondary>}
    </Container></Card>;
}
