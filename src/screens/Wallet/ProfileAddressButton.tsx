import { ButtonSecondary } from '@components/Button';
import useBrowserStorage from '@hooks/useBrowserStorage.ts';
import { t } from '@services/i18n/i18n.ts';
import type { ProfileMetadata } from '@domain/profile/profileMetadata.ts';

interface Props {
  pubkey: string;
  address: string;
  cachedAddress?: string;
  onAdd: () => void;
}

/** Subscribe to the same cache written by profile reads and successful publication. */
export default function ProfileAddressButton({ pubkey, address, cachedAddress, onAdd }: Props) {
  const profile = useBrowserStorage<{ metadata: ProfileMetadata } | null>(`profile_${pubkey}`, null);
  const profileAddress = profile ? profile.metadata.lud16 : cachedAddress;
  const added = !!address && profileAddress?.trim() === address.trim();
  return (
    <ButtonSecondary small disabled={added} onClick={onAdd}>
      {t(added ? 'wallet.addedToProfile' : 'wallet.addToProfile')}
    </ButtonSecondary>
  );
}
