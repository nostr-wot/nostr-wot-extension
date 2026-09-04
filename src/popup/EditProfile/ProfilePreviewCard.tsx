import React from 'react';
import { t } from '@lib/i18n.js';
import Avatar from '@components/Avatar/Avatar';
import Button from '@components/Button/Button';
import { type ProfileMetadata } from '@shared/profileMetadata.ts';
import Card from '@components/Card/Card';
import FormError from '@components/FormError/FormError';

interface ProfilePreviewCardProps {
  meta: ProfileMetadata | null;
  displayPicture: string | null;
  initial: string;
  error: string;
  onBack: () => void;
  onConfirm: () => void;
}

/** What the profile will look like once published, and the confirm step. */
export default function ProfilePreviewCard({
  meta, displayPicture, initial, error, onBack, onConfirm,
}: ProfilePreviewCardProps) {
  return (
  <div className="flex-1 overflow-y-auto flex flex-col gap-7">
    <Card variant="flat" className="flex flex-col gap-4 mb-0">
      <div className="flex items-center gap-5">
        <Avatar
          src={meta?.picture}
          fallback={initial}
          imgClassName="size-20 rounded-full object-cover border border-card-border"
          fallbackClassName="size-20 rounded-full bg-brand-light flex items-center justify-center text-2xl font-bold text-brand"
        />
        <span className="text-lg font-bold text-heading">{meta?.name || meta?.display_name || '\u2014'}</span>
      </div>
      {meta?.about && <div className="text-sm text-body leading-normal">{meta.about}</div>}
      {meta?.nip05 && (
        <dl className="flex gap-3 text-xs">
          <dt className="text-muted min-w-[60px] font-semibold">NIP-05</dt><dd className="text-body break-all">{meta.nip05}</dd>
        </dl>
      )}
      {meta?.lud16 && (
        <dl className="flex gap-3 text-xs">
          <dt className="text-muted min-w-[60px] font-semibold">Lightning</dt><dd className="text-body break-all">{meta.lud16}</dd>
        </dl>
      )}
      {meta?.website && (
        <dl className="flex gap-3 text-xs">
          <dt className="text-muted min-w-[60px] font-semibold">Website</dt><dd className="text-body break-all">{meta.website}</dd>
        </dl>
      )}
    </Card>

    <div className="text-xs text-muted text-center">{t('profileEdit.previewHint')}</div>

    <FormError>{error}</FormError>

    <div className="flex gap-4 mt-2">
      <Button className="flex-1" variant="secondary" onClick={onBack}>
        {t('common.back')}
      </Button>
      <Button className="flex-1" onClick={onConfirm}>{t('profileEdit.confirmPublish')}</Button>
    </div>
  </div>
  );
}
