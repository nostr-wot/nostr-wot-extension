import { safeImageUrl } from '@utils/safeUrl.ts';
import type { WotScoreExplanation } from '@domain/wot/types.ts';
import type { ProfileMetadata } from '@domain/profile/profileMetadata.ts';
import { truncateNpub } from '@domain/nostr/display.ts';
import { npubEncode } from '@lib/crypto/bech32.ts';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import Modal from '@components/Modal';
import ProfileSummary from '@components/ProfileSummary';
import CopyButton from '@components/CopyButton';
import Container from '@components/Container';
import Text from '@components/Text';
import FormError from '@components/FormError';
import { ButtonSecondary } from '@components/Button';
import WotScoreBreakdown from './WotScoreBreakdown';

/** Independent reads let scoring finish even when profile relays are unavailable. */
export default function WotScoreResultModal({ target, onClose }: { target: string; onClose: () => void }) {
    const profile = useAsyncResource<{ metadata: ProfileMetadata | null }>({ metadata: null }, { load: async (patch, isCurrent) => {
        const metadata = await rpc<ProfileMetadata | null>('getProfileMetadata', { pubkey: target });
        if (isCurrent()) patch({ metadata });
    } });
    const score = useAsyncResource<{ explanation: WotScoreExplanation | null }>({ explanation: null }, { load: async (patch, isCurrent) => {
        const explanation = await rpc<WotScoreExplanation>('experimentalWot_getScoreExplanation', { target });
        if (isCurrent()) patch({ explanation });
    } });
    const metadata = profile.data.metadata;
    const hasProfile = !!metadata && (
        typeof metadata.name === 'string' && !!metadata.name.trim()
        || typeof metadata.display_name === 'string' && !!metadata.display_name.trim()
        || !!safeImageUrl(metadata.picture)
    );
    return <Modal title={t('wot.scoring')} onClose={onClose}>
        {hasProfile ? <ProfileSummary meta={{name: metadata?.name, display_name: metadata?.display_name, picture: metadata?.picture}}/> : <Container variant="row" gap={3}>
            <Text mono>{truncateNpub(target)}</Text>
            <CopyButton iconOnly value={npubEncode(target)} label={t('wot.lookupPubkey')}/>
        </Container>}
        {profile.loading && <Text variant="hint">{t('common.loading')}</Text>}
        <Container gap={3} role="status" aria-live="polite">
            {score.loading ? <Text>{t('wot.calculating')}</Text>
                : !score.error && score.data.explanation && <WotScoreBreakdown result={score.data.explanation}/>}
            <FormError>{score.error}</FormError>
            {score.error && <ButtonSecondary onClick={() => { void score.refresh(); }}>{t('common.retry')}</ButtonSecondary>}
        </Container>
    </Modal>;
}
