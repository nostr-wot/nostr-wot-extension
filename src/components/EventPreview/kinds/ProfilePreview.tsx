import { t } from '@services/i18n/i18n.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import type { ProfileMetadata } from '@domain/profile/profileMetadata.ts';
import ProfileSummary from '@components/ProfileSummary';
import Heading from '@components/Heading';
import Text from '@components/Text';

export default function ProfilePreview({ event }: { event: NostrEventDisplay }) {
  let meta: ProfileMetadata;
  try {
    meta = JSON.parse(event.content);
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Invalid profile');
  } catch {
    return <Text variant="hint" className="text-sm italic mt-2">{t('event.noEventData')}</Text>;
  }
  return <>
    <Heading level={5} as="h3" className="m-0 mb-4">{t('event.profileUpdate')}</Heading>
    <ProfileSummary meta={meta} />
  </>;
}
