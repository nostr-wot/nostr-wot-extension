import React from 'react';
import { t } from '@lib/i18n.js';
import ListRow from '@components/ListRow/ListRow';
import { IconUser } from '@assets';
import { useNavigate } from './NavigationContext';

/**
 * "Edit profile" row in the Account group — opens EditProfileOverlay to edit the
 * user's kind:0 metadata. Avatar + name are already shown in the top bar, so the
 * subtitle just names what this edits.
 */
export default function ProfileRow() {
  const navigate = useNavigate();
  return (
    <ListRow
      leading={<IconUser size={16} />}
      title={t('home.editProfile')}
      subtitle={t('home.profileSummary')}
      onClick={navigate.editProfile}
    />
  );
}
