import { t } from '@services/i18n/i18n.ts';
import Modal from '@components/Modal';
import Container from '@components/Container';
import Text from '@components/Text';
import { SectionLabel } from '@components/SectionLabel';
import Button from '@components/Button';
export default function WotHowItWorks({ onClose }: { onClose: () => void }) {
    return <Modal title={t('wot.howTitle')} onClose={onClose} footer={<Button onClick={onClose}>{t('common.gotIt')}</Button>}>
        <Container gap={5}>
            <Text>{t('wot.experimentalNotice')}</Text>
            <Container gap={2}><SectionLabel>{t('wot.mode')}</SectionLabel><Text>{t('wot.howModes')}</Text></Container>
            <Container gap={2}><SectionLabel>{t('wot.scoring')}</SectionLabel><Text>{t('wot.scoringHint')}</Text><Text>{t('wot.muteOverride')}</Text></Container>
            <Container gap={2}><SectionLabel>{t('wot.autoSync')}</SectionLabel><Text>{t('wot.autoSyncHint')}</Text><Text>{t('wot.howUpdates')}</Text></Container>
            <Container gap={2}><SectionLabel>{t('wot.databases')}</SectionLabel><Text>{t('wot.databaseHint')}</Text><Text>{t('wot.howPrivacy')}</Text></Container>
        </Container>
    </Modal>;
}
