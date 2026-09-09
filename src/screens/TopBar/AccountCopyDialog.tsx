import { t } from '@services/i18n/i18n.ts';
import { npubEncode } from '@lib/crypto/bech32.ts';
import { truncateMiddle } from '@utils/format/text.ts';
import useCopy from '@hooks/useCopy';
import Modal from '@components/Modal';
import { ButtonSecondary } from '@components/Button';

export default function AccountCopyDialog({ pubkey, onClose }: { pubkey: string; onClose: () => void }) {
  const { copy, copied, failed } = useCopy();
  const npub = npubEncode(pubkey);
  return <Modal title={t('common.copy')} onClose={onClose} maxWidth={320}>
    <div className="flex flex-col gap-5">
      <span className="text-xs font-mono text-secondary" title={npub}>{truncateMiddle(npub, 16, 8)}</span>
      <div className="flex gap-4">
        <ButtonSecondary className="flex-1" onClick={() => void copy(npub)}>npub</ButtonSecondary>
        <ButtonSecondary className="flex-1" onClick={() => void copy(pubkey)}>hex</ButtonSecondary>
      </div>
      {(copied || failed) && <span role="status" className={failed ? 'text-error text-sm' : 'text-success text-sm'}>{t(copied ? 'common.copied' : 'common.error')}</span>}
    </div>
  </Modal>;
}
