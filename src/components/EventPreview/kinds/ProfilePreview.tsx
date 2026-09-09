import { t } from '@services/i18n/i18n.ts';
import { safeImageUrl } from '@utils/safeUrl.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import Avatar from '@components/Avatar/Avatar';
import { EP } from '../eventPreviewClasses.ts';
import type { ProfileMetadata } from '@domain/profile/profileMetadata.ts';

interface ProfilePreviewProps {
  event: NostrEventDisplay;
}

export default function ProfilePreview({ event }: ProfilePreviewProps) {
  try {
    const meta: ProfileMetadata = JSON.parse(event.content);
    const displayName = meta.name || meta.display_name || '';
    const initial = displayName ? displayName[0].toUpperCase() : '?';
    // Banner comes from untrusted event content — only render http(s) URLs.
    const bannerUrl = safeImageUrl(meta.banner);

    // Built as a list, then mapped with an index, so first/last padding can
    // be computed here instead of via the old `:first-of-type`/`:last-of-type`
    // selectors — which fields are present is data-dependent, so there is no
    // fixed index to hard-code.
    const fields: { key: string; label: string; value: string }[] = [
      meta.nip05 && { key: 'nip05', label: 'NIP-05', value: meta.nip05 },
      meta.lud16 && { key: 'lud16', label: t('event.lightning'), value: meta.lud16 },
      meta.website && { key: 'website', label: t('profileEdit.website'), value: meta.website },
    ].filter((f): f is { key: string; label: string; value: string } => !!f);

    return (
      <>
        <h3 className={EP.sectionTitle}>{t('event.profileUpdate')}</h3>
        <div className={EP.profileCard}>
          {bannerUrl && (
            <div className={EP.profileBanner}>
              <img src={bannerUrl} alt="" />
            </div>
          )}
          {/* -mt-8 only when a banner actually rendered above it — replaces
              the old `.profileBanner + .profileHeader` sibling rule. */}
          <div className={`${EP.profileHeader} ${bannerUrl ? EP.profileHeaderAfterBanner : ''}`}>
            <Avatar
              src={meta.picture}
              fallback={initial}
              imgClassName={EP.profileAvatar}
              fallbackClassName={EP.profileAvatarPlaceholder}
            />
            <span className={EP.profileName}>{displayName || '—'}</span>
          </div>
          {meta.about && <div className={EP.profileAbout}>{meta.about}</div>}
          {fields.map((f, i) => (
            <dl
              key={f.key}
              className={[
                EP.profileField,
                i === 0 ? EP.profileFieldFirst : '',
                i === fields.length - 1 ? EP.profileFieldLast : '',
              ].filter(Boolean).join(' ')}
            >
              <dt className={EP.profileFieldLabel}>{f.label}</dt>
              <dd className={EP.profileFieldValue}>{f.value}</dd>
            </dl>
          ))}
        </div>
      </>
    );
  } catch {
    return <div className={EP.eventNote}>{t('event.noEventData')}</div>;
  }
}
