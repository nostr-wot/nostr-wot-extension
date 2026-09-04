import React from 'react';
import { t } from '@lib/i18n.js';
import { safeImageUrl } from '@shared/safeUrl.ts';
import type { NostrEventDisplay } from '@models/nostrEvent.ts';
import Avatar from '@components/Avatar/Avatar';
import styles from '../EventPreview.module.css';
import type { ProfileMetadata } from '@models/profile.ts';


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

    return (
      <>
        <h3 className={styles.sectionTitle}>{t('event.profileUpdate')}</h3>
        <div className={styles.profileCard}>
          {bannerUrl && (
            <div className={styles.profileBanner}>
              <img src={bannerUrl} alt="" />
            </div>
          )}
          <div className={styles.profileHeader}>
            <Avatar
              src={meta.picture}
              fallback={initial}
              imgClassName={styles.profileAvatar}
              fallbackClassName={styles.profileAvatarPlaceholder}
            />
            <span className={styles.profileName}>{displayName || '\u2014'}</span>
          </div>
          {meta.about && <div className={styles.profileAbout}>{meta.about}</div>}
          {meta.nip05 && (
            <dl className={styles.profileField}>
              <dt>NIP-05</dt><dd>{meta.nip05}</dd>
            </dl>
          )}
          {meta.lud16 && (
            <dl className={styles.profileField}>
              <dt>{t('event.lightning')}</dt><dd>{meta.lud16}</dd>
            </dl>
          )}
          {meta.website && (
            <dl className={styles.profileField}>
              <dt>{t('profileEdit.website')}</dt><dd>{meta.website}</dd>
            </dl>
          )}
        </div>
      </>
    );
  } catch {
    return <div className={styles.eventNote}>{t('event.noEventData')}</div>;
  }
}
