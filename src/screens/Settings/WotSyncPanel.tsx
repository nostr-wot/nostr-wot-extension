import type { WotState } from '@domain/wot/types.ts';
import { t } from '@services/i18n/i18n.ts';
import { formatTimeAgo } from '@services/i18n/timeLabels.ts';
import Card from '@components/Card';
import Container from '@components/Container';
import Text from '@components/Text';
import WotSyncStatus from './WotSyncStatus';
import FieldDisplay from '@components/FieldDisplay';
import FormError from '@components/FormError';
import StatusNotice from '@components/StatusNotice';
import IconWarning from '@assets/IconWarning';
import { ButtonSecondary } from '@components/Button';

export default function WotSyncPanel({ state, onSettings }: {
    state: WotState; onSettings?: () => void;
}) {
    const progress = state.progress;
    const running = progress?.running === true;
    return <Card><Container gap={4}>
        <WotSyncStatus hasGraph={state.hasLocalGraph} incomplete={state.truncated || !!state.missingFollowLists} progress={progress}/>
        <FieldDisplay label={t('wot.people')} value={running ? String(progress.people) : state.hasLocalGraph ? String(state.people ?? 0) : '—'}/>
        <FieldDisplay label={t('wot.localGraph')} value={running ? String(progress.lists) : state.hasLocalGraph ? String(state.authors) : '—'}/>
        <FormError>{progress?.error}</FormError>
        {state.updatedAt && <FieldDisplay label={t('wot.updated')} value={formatTimeAgo(state.updatedAt)}/>}
        {!!state.missingFollowLists && <Text variant="secondary">{t('wot.missingLists')}: {state.missingFollowLists}</Text>}
        {state.settings.enabled && state.muteStatus !== 'ready' && <StatusNotice variant="callout" tone="warn" icon={<IconWarning />}>{t(state.muteStatus === 'private-unavailable' ? 'wot.privateMutesUnavailable' : 'wot.mutesUnavailable')}</StatusNotice>}
        {onSettings && <ButtonSecondary onClick={onSettings}>{t('wot.syncSettings')}</ButtonSecondary>}
    </Container></Card>;
}
