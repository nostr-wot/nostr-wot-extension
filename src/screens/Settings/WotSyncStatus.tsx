import type { WotSyncProgress } from '@domain/wot/types.ts';
import { wotHopPercent, wotSyncStatus } from '@domain/wot/syncStatus.ts';
import { t } from '@services/i18n/i18n.ts';
import Container from '@components/Container';
import Text from '@components/Text';
import StatusDot from '@components/StatusDot';

export default function WotSyncStatus({ hasGraph, incomplete = false, progress }: {
    hasGraph: boolean; incomplete?: boolean; progress?: WotSyncProgress | null;
}) {
    const status = wotSyncStatus(hasGraph, incomplete, progress);
    return <Container gap={2} role="status" aria-live="polite">
        <Container variant="row" gap={3}><StatusDot status={status.tone}/><Text>{t(status.label)}</Text></Container>
        {progress?.running && <Text variant="hint">{t('wot.currentHop')} {progress.depth || 1} · {wotHopPercent(progress)}% {t('wot.hopProgress')}</Text>}
    </Container>;
}
