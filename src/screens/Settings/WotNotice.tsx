import { useState } from 'react';
import browser from '@lib/browser.ts';
import { WOT_NOTICE_DISMISSED_KEY } from '@constants/wot.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import { t } from '@services/i18n/i18n.ts';
import Modal from '@components/Modal';
import Button from '@components/Button';
import Toggle from '@components/Toggle';
import Container from '@components/Container';
import Text from '@components/Text';
import FormError from '@components/FormError';

export default function WotNotice() {
    const preference = useAsyncResource({ hidden: false }, { load: async (patch, isCurrent) => {
        const stored = await browser.storage.local.get(WOT_NOTICE_DISMISSED_KEY);
        if (isCurrent()) patch({ hidden: stored[WOT_NOTICE_DISMISSED_KEY] === true });
    } });
    const [closed, setClosed] = useState(false);
    const [dontShow, setDontShow] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    async function close() {
        setSaving(true);
        try {
            if (dontShow) await browser.storage.local.set({ [WOT_NOTICE_DISMISSED_KEY]: true });
            setClosed(true);
        } catch (e) { setError((e as Error).message); }
        finally { setSaving(false); }
    }
    if (preference.loading || preference.data.hidden || closed) return null;
    return <Modal title={t('wot.title')} onClose={() => { if (!saving) void close(); }} footer={<Button disabled={saving} onClick={() => { void close(); }}>{t('common.gotIt')}</Button>}>
        <Container gap={5}>
            <Text>{t('wot.experimentalNotice')}</Text>
            <Container variant="row" gap={4}>
                <Text className="flex-1">{t('wot.dontShowAgain')}</Text>
                <Toggle aria-label={t('wot.dontShowAgain')} checked={dontShow} disabled={saving} onChange={setDontShow}/>
            </Container>
            <FormError>{error || preference.error}</FormError>
        </Container>
    </Modal>;
}
