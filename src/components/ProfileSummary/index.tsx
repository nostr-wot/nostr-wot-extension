import { publicProfile, profileDisplayName } from '@domain/profile/publicProfile';
import type { ProfileMetadata } from '@domain/profile/profileMetadata.ts';
import { safeImageUrl } from '@utils/safeUrl.ts';
import { t } from '@services/i18n/i18n.ts';
import Container from '@components/Container';
import Heading from '@components/Heading';
import Text from '@components/Text';
import Avatar from '@components/Avatar';
import FieldDisplay from '@components/FieldDisplay';

/** Shared read-only profile presentation for event review and the publish preview. */
export default function ProfileSummary({ meta, initial, compact = false, fallback }: { meta: ProfileMetadata | null; initial?: string; compact?: boolean; fallback?: string }) {
  meta = publicProfile(meta);
  const name = profileDisplayName(meta, fallback);
  const banner = safeImageUrl(meta?.banner);
  if (compact) return <div className="flex items-center gap-3 min-w-0">
    <Avatar key={meta?.picture || name} src={meta?.picture} fallback={initial || name[0]?.toUpperCase() || '?'}
      imgClassName="size-12 rounded-full object-cover"
      fallbackClassName="size-12 rounded-full shrink-0 bg-brand-light text-brand flex items-center justify-center" />
    <Text className="font-medium break-all">{name}</Text>
  </div>;
  return <Container variant="box" gap={4}>
    {!compact && banner && <img src={banner} alt={t('profileEdit.banner')} className="w-full h-[100px] object-cover rounded-md" />}
    <Container variant="row" gap={5}>
      <Avatar src={meta?.picture} fallback={initial || name[0].toUpperCase()}
        imgClassName="size-20 rounded-full object-cover border border-card-border"
        fallbackClassName="size-20 rounded-full bg-brand-light flex items-center justify-center text-2xl font-bold text-brand" />
      <Heading level={5} as="h4" className="m-0 text-lg">{name}</Heading>
    </Container>
    {!compact && meta?.about && <Text className="text-sm whitespace-pre-wrap break-words">{meta.about}</Text>}
    {!compact && meta?.nip05 && <FieldDisplay label="NIP-05" value={meta.nip05} />}
    {!compact && meta?.lud16 && <FieldDisplay label={t('event.lightning')} value={meta.lud16} />}
    {!compact && meta?.website && <FieldDisplay label={t('profileEdit.website')} value={meta.website} />}
  </Container>;
}
