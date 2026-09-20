import { t } from '@services/i18n/i18n.ts';
import { npubEncode } from '@lib/crypto/bech32.ts';
import useCopy from '@hooks/useCopy';
import ActionMenu from '@components/ActionMenu';
import IconButton from '@components/IconButton';
import IconCopy from '@assets/IconCopy';
import ScreenReaderStatus from '@components/ScreenReaderStatus';
import FormError from '@components/FormError';

/** Reuse the action menu and clipboard feedback; no extra dialog for format choice. */
export default function AccountCopyMenu({ pubkey }: { pubkey?: string }) {
    const { copy, copied, failed } = useCopy();
    const feedback = copied ? t('common.copied') : failed ? t('common.error') : '';
    return <>
        <ActionMenu label={feedback || t('common.copy')} disabled={!pubkey}
            options={[{value:'hex',label:'hex'},{value:'npub',label:'npub'}]}
            onSelect={async format => pubkey ? copy(format === 'npub' ? npubEncode(pubkey) : pubkey) : false}
            trigger={props => <IconButton {...props} title={feedback || t('common.copy')}><IconCopy size={16}/></IconButton>}
            description={<FormError>{failed ? feedback : ''}</FormError>}/>
        <ScreenReaderStatus>{feedback}</ScreenReaderStatus>
    </>;
}
