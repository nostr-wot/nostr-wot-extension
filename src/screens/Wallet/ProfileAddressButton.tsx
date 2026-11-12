import { ButtonSecondary } from '@components/Button';
import useBrowserStorage from '@hooks/useBrowserStorage.ts';
import { t } from '@services/i18n/i18n.ts';
import { publicProfile } from '@domain/profile/publicProfile';

interface Props {
  pubkey: string;
  address: string;
  cachedAddress?: string;
  onAdd: () => void;
}

/** Subscribe to the same cache written by profile reads and successful publication. */
export default function ProfileAddressButton({ pubkey, address, cachedAddress, onAdd }: Props) {
  const profile = useBrowserStorage<{ metadata?: unknown } | null>(`profile_${pubkey}`, null);
  const metadata = publicProfile(profile?.metadata);
  const profileAddress = metadata ? metadata.lud16 : cachedAddress;
  const added = !!address && profileAddress?.trim() === address.trim();
  return (
    <ButtonSecondary small disabled={added} onClick={onAdd}>
      {t(added ? 'wallet.addedToProfile' : 'wallet.addToProfile')}
    </ButtonSecondary>
  );
}
