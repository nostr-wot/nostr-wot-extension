import React from 'react';
import { t } from '@lib/i18n.js';
import NavRow from '@components/NavRow/NavRow';
import { IconUser } from '@assets';

/**
 * "Edit profile" row in the Account group — opens EditProfileOverlay to edit the
 * user's kind:0 metadata. Avatar + name are already shown in the top bar, so the
 * subtitle just names what this edits.
 */
export default function ProfileCard({ onEdit }: { onEdit: () => void }) {
  return (
    <NavRow
      icon={<IconUser size={16} />}
      title={t('home.editProfile')}
      subtitle={t('home.profileSummary')}
      onClick={onEdit}
    />
  );
}
