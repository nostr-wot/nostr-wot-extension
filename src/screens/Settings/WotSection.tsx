import Modal from '@components/Modal';
import WotSyncScreen from './WotSyncScreen';
import WotScoreLookup from './WotScoreLookup';
import WotScoringPanel from './WotScoringPanel';
import WotSyncPanel from './WotSyncPanel';
import { useEffect, useState } from 'react';
import { useAccount } from '@context/AccountContext';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import useStorageWatch from '@hooks/useStorageWatch.ts';
import { RELAY_CACHE_PREFIX, MUTE_LIST_CACHE } from '@constants/relays.ts';
import { WOT_DEFAULTS, WOT_SETTINGS_KEY, WOT_GRAPH_PREFIX, WOT_SYNC_STATUS_KEY } from '@constants/wot.ts';
import { validateWotSettings, validateWotScoring } from '@domain/wot/validation.ts';
import type { WotSettings, WotState, WotScoring } from '@domain/wot/types.ts';
import Container from '@components/Container';
import Text from '@components/Text';
import Toggle from '@components/Toggle';
import Card from '@components/Card';
import browser from '@lib/browser.ts';
import WotNotice from './WotNotice';
import Button, { ButtonSecondary } from '@components/Button';
import FormError from '@components/FormError';
import StatusNotice from '@components/StatusNotice';
import IconWarning from '@assets/IconWarning';
const EMPTY: WotState = { settings: WOT_DEFAULTS, hasLocalGraph: false, syncing: false, updatedAt: null, authors: 0, truncated: false };
export default function WotSection() {
    const { active } = useAccount();
    return <WotSettingsForm key={active?.id || 'none'} accountId={active?.id} pubkey={active?.pubkey}/>;
}
export function WotSettingsForm({ accountId, pubkey }: {
    accountId?: string;
    pubkey?: string;
}) {
    const resource = useAsyncResource<WotState>(EMPTY, { load: async (patch, isCurrent) => { const state = await rpc<WotState>('experimentalWot_getState'); if (isCurrent()) patch(state); } });
    const [draft, setDraft] = useState<WotSettings>({ ...WOT_DEFAULTS });
    const [busy, setBusy] = useState(false), [syncing, setSyncing] = useState(false), [error, setError] = useState('');
    const [panel, setPanel] = useState<'sync' | 'scoring' | null>(null);
    const savedSettings = JSON.stringify(resource.data.settings);
    const savedSyncSettings = JSON.stringify({ ...resource.data.settings, scoring: undefined });
    const savedScoring = JSON.stringify(resource.data.settings.scoring);
    useEffect(() => { setDraft(current => ({ ...current, ...JSON.parse(savedSyncSettings) })); }, [savedSyncSettings]);
    useEffect(() => { setDraft(current => ({ ...current, scoring: JSON.parse(savedScoring) })); }, [savedScoring]);
    useStorageWatch([{ area: 'local', keys: [WOT_SETTINGS_KEY, WOT_SYNC_STATUS_KEY, WOT_GRAPH_PREFIX + accountId, RELAY_CACHE_PREFIX + MUTE_LIST_CACHE + '_' + pubkey] }], resource.refresh);
    let validation = '';
    try {
        validateWotSettings({ ...draft, enabled: true });
    }
    catch (e) {
        validation = (e as Error).message;
    }
    const staleBackground = (error || resource.error).startsWith('Unknown method: experimentalWot_');
    const unavailable = resource.loading || !!resource.error;
    const syncBusy = syncing || resource.data.syncing;
    const dirty = JSON.stringify({ ...resource.data.settings, ...draft }) !== savedSettings;
    async function action(method: string, params?: Record<string, unknown>) {
        setBusy(true);
        setError('');
        try {
            resource.patch(await rpc<WotState>(method, params));
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setBusy(false);
        }
    }
    function applyScoring(scoring: WotScoring) {
        setDraft(current => ({ ...current, scoring }));
        setError('');
        try { validateWotScoring(scoring); }
        catch { return; }
        void action('experimentalWot_save', { ...resource.data.settings, scoring });
    }
    async function sync() {
        setSyncing(true);
        setError('');
        try {
            resource.patch(await rpc<WotState>('experimentalWot_sync'));
        }
        catch (e) {
            setError((e as Error).message);
        }
        finally {
            setSyncing(false);
        }
    }
    const saveButton = dirty && <Button disabled={!!validation || busy || syncBusy || unavailable} onClick={() => { void action('experimentalWot_save', { ...draft }); }}>{t('common.save')}</Button>;
    function closeSettings() {
        if (!busy) { setPanel(null); setDraft(resource.data.settings); setError(''); }
    }
    return <Container gap={6}>
    <WotNotice/>
    <Card><Container gap={4}>
    <Container variant="row" gap={5}>
      <Text className="flex-1">{t('wot.enable')}</Text>
      <Toggle aria-label={t('wot.enable')} checked={resource.data.settings.enabled} disabled={unavailable || busy || (!resource.data.settings.enabled && (!!validation || !accountId))} onChange={enabled => { void action('experimentalWot_save', enabled ? { ...draft, enabled } : { ...resource.data.settings, enabled }); }}/>
    </Container>
    <Text variant="secondary">{t('wot.consent')}</Text>
    </Container></Card>
    <FormError>{staleBackground ? t('wot.reloadRequired') : error || resource.error || (dirty ? validation : '')}</FormError>
    {staleBackground ? <ButtonSecondary onClick={() => browser.runtime.reload()}>{t('wot.reloadExtension')}</ButtonSecondary> : resource.error && <ButtonSecondary onClick={() => { void resource.refresh(); }}>{t('common.retry')}</ButtonSecondary>}
    <WotSyncPanel state={{ ...resource.data, syncing: syncBusy }} autoSync={draft.autoSync} onAutoSync={autoSync => setDraft({ ...draft, autoSync })} busy={busy || unavailable} onSettings={() => setPanel('sync')}/>
    {!panel && saveButton}
    <WotScoreLookup revision={JSON.stringify([accountId, savedSettings, resource.data.updatedAt, resource.data.muteStatus])} disabled={!resource.data.settings.enabled || !accountId || !!resource.error} onSettings={() => setPanel('scoring')}/>
    {panel === 'sync' && <WotSyncScreen draft={draft} setDraft={setDraft} state={{ ...resource.data, syncing: syncBusy }} disabled={busy || syncBusy || unavailable} canSync={resource.data.settings.enabled && !!accountId && !dirty} onSync={() => { void sync(); }} onClear={() => { void action('experimentalWot_clear'); }} onBack={closeSettings} footer={saveButton} error={error || (dirty ? validation : '')}/>}
    {panel === 'scoring' && <Modal title={t('wot.scoring')} onClose={closeSettings}>
      <WotScoringPanel value={draft.scoring} onChange={applyScoring} disabled={busy || syncBusy || unavailable}/>
      <FormError>{error || (dirty ? validation : '')}</FormError>
    </Modal>}

    <StatusNotice variant="callout" tone="warn" icon={<IconWarning />}>{t('wot.experimentalNotice')}</StatusNotice>
  </Container>;
}
