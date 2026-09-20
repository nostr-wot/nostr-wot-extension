import browser from '@lib/browser.ts';
import { WOT_AUTO_SYNC_ALARM, WOT_AUTO_SYNC_MINUTES, WOT_SETTINGS_KEY } from '@constants/wot.ts';
import { getWotSettings } from './state.ts';
import { isWotSyncing, syncWotGraph } from './sync.ts';

/** Browser alarms survive worker suspension; no permanent sockets or timer loops. */
export function installWotAutoSync(deps = { settings: getWotSettings, sync: () => syncWotGraph({incremental:true}), busy: isWotSyncing }) {
    let stopped = false;
    let alarmQueued = false;
    let queued: Promise<void> = Promise.resolve();
    async function refresh() {
        const settings = await deps.settings();
        if (!stopped && settings.enabled && settings.autoSync && !deps.busy()) await deps.sync();
    }
    function reconcile(refreshNow: boolean) {
        queued = queued.catch(() => {}).then(async () => {
            const settings = await deps.settings();
            if (stopped || !settings.enabled || !settings.autoSync) {
                await browser.alarms.clear(WOT_AUTO_SYNC_ALARM);
                return;
            }
            const alarm = await browser.alarms.get(WOT_AUTO_SYNC_ALARM);
            if (alarm?.periodInMinutes !== WOT_AUTO_SYNC_MINUTES)
                await browser.alarms.create(WOT_AUTO_SYNC_ALARM, { periodInMinutes: WOT_AUTO_SYNC_MINUTES });
            if (refreshNow) await refresh();
        }).catch(() => { /* Sync reports failures in its persisted progress state. */ });
        return queued;
    }
    const onChanged = (changes: Record<string, unknown>, area: string) => {
        if (area === 'local' && (WOT_SETTINGS_KEY in changes || 'activeAccountId' in changes)) void reconcile(false);
    };
    const onAlarm = (alarm: { name: string }) => {
        if (alarm.name !== WOT_AUTO_SYNC_ALARM || stopped || alarmQueued || deps.busy()) return;
        alarmQueued = true;
        void reconcile(true).finally(() => { alarmQueued = false; });
    };
    browser.storage.onChanged.addListener(onChanged);
    browser.alarms.onAlarm.addListener(onAlarm);
    void reconcile(false);
    return {
        settled: () => queued,
        stop() { stopped = true; browser.storage.onChanged.removeListener(onChanged); browser.alarms.onAlarm.removeListener(onAlarm); return reconcile(false); },
    };
}
