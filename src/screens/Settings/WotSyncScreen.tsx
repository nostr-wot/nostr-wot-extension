import WotSyncStatus from './WotSyncStatus';
import Card from '@components/Card';
import Toggle from '@components/Toggle';
import type { ReactNode } from 'react';
import type { WotSettings, WotState } from '@domain/wot/types.ts';
import { t } from '@services/i18n/i18n.ts';
import OverlayPanel from '@components/OverlayPanel';
import Container from '@components/Container';
import Text from '@components/Text';
import FormError from '@components/FormError';
import { ButtonSecondary } from '@components/Button';
import WotSyncSettings from './WotSyncSettings';
import WotDatabases from './WotDatabases';

export default function WotSyncScreen({ draft, setDraft, state, disabled, canSync, onSync, onBack, footer, error }: {
    draft: WotSettings; setDraft: (value: WotSettings) => void; state: WotState;
    disabled: boolean; canSync: boolean; onSync: () => void;
    onBack: () => void; footer: ReactNode; error: string;
}) {
    return <OverlayPanel className="[background:var(--bg-page)]" title={t('wot.syncSettings')} onBack={onBack} onClose={onBack}>
        <Container gap={5} className="flex-1 min-h-0 overflow-y-auto">
            <Text variant="secondary">{t('wot.syncNotice')}</Text>
            <Text variant="secondary">{t('wot.mutes')}</Text>
            <Card><Container gap={4}>
                <Container variant="row" gap={4}>
                    <Text className="flex-1">{t('wot.autoSync')}</Text>
                    <Toggle aria-label={t('wot.autoSync')} checked={draft.autoSync} disabled={disabled} onChange={autoSync => setDraft({ ...draft, autoSync })}/>
                </Container>
                <Text variant="secondary">{t('wot.autoSyncHint')}</Text>
            </Container></Card>
            {!state.hasLocalGraph && state.syncing && <WotSyncStatus hasGraph={false} progress={state.progress}/>}
            {!state.hasLocalGraph && <ButtonSecondary disabled={!canSync || disabled} onClick={onSync}>{state.syncing ? t('wot.syncing') : t('wot.sync')}</ButtonSecondary>}
            <WotSyncSettings draft={draft} setDraft={setDraft} disabled={disabled}/>
            <WotDatabases revision={state.updatedAt} progress={state.databaseProgress} disabled={disabled} canSync={canSync}/>
        </Container>
        <Container gap={4} className="shrink-0 pt-4">
            <FormError>{error}</FormError>
            {footer}
        </Container>
    </OverlayPanel>;
}
