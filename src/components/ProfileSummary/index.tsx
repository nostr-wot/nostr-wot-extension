import type { ProfileMetadata } from '@domain/profile/profileMetadata.ts';
import { safeImageUrl } from '@utils/safeUrl.ts';
import { t } from '@services/i18n/i18n.ts';
import Container from '@components/Container';
import Heading from '@components/Heading';
import Text from '@components/Text';
import Avatar from '@components/Avatar';
import FieldDisplay from '@components/FieldDisplay';

/** Shared read-only profile presentation for event review and the publish preview. */
export default function ProfileSummary({ meta, initial }: { meta: ProfileMetadata | null; initial?: string }) {
  meta = Object.fromEntries(Object.entries(meta || {}).filter(([, value]) => typeof value === 'string'));
  const name = meta?.name || meta?.display_name || '—';
  const banner = safeImageUrl(meta?.banner);
  return <Container variant="box" gap={4}>
    {banner && <img src={banner} alt={t('profileEdit.banner')} className="w-full h-[100px] object-cover rounded-md" />}
    <Container variant="row" gap={5}>
      <Avatar src={meta?.picture} fallback={initial || name[0].toUpperCase()}
        imgClassName="size-20 rounded-full object-cover border border-card-border"
        fallbackClassName="size-20 rounded-full bg-brand-light flex items-center justify-center text-2xl font-bold text-brand" />
      <Heading level={5} as="h4" className="m-0 text-lg">{name}</Heading>
    </Container>
    {meta?.about && <Text className="text-sm whitespace-pre-wrap break-words">{meta.about}</Text>}
    {meta?.nip05 && <FieldDisplay label="NIP-05" value={meta.nip05} />}
    {meta?.lud16 && <FieldDisplay label={t('event.lightning')} value={meta.lud16} />}
    {meta?.website && <FieldDisplay label={t('profileEdit.website')} value={meta.website} />}
  </Container>;
}
