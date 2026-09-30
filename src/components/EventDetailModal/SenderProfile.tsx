import ProfileSummary from '@components/ProfileSummary';
import usePublicProfile from '@hooks/usePublicProfile';
import { truncateMiddle } from '@utils/format/text';

export default function SenderProfile({ pubkey, lookup = true }: { pubkey: string; lookup?: boolean }) {
  const { profile } = usePublicProfile(pubkey, { lookup });
  return <ProfileSummary meta={profile} compact fallback={truncateMiddle(pubkey, 16, 12)} />;
}
