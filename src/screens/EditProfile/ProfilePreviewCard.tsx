import React from 'react';
import { t } from '@lib/i18n.js';
import Avatar from '@components/Avatar/Avatar';
import Button from '@components/Button/Button';
import { type ProfileMetadata } from '@domain/profile/profileMetadata.ts';
import Card from '@components/Card/Card';
import FormError from '@components/FormError/FormError';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

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
  <Container gap={7} className="flex-1 overflow-y-auto">
    <Card variant="flat" className="flex flex-col gap-4 mb-0">
      <Container variant="row" gap={5}>
        <Avatar
          src={meta?.picture}
          fallback={initial}
          imgClassName="size-20 rounded-full object-cover border border-card-border"
          fallbackClassName="size-20 rounded-full bg-brand-light flex items-center justify-center text-2xl font-bold text-brand"
        />
        <span className="text-lg font-bold text-heading">{meta?.name || meta?.display_name || '\u2014'}</span>
      </Container>
      {meta?.about && <Text variant="body" as="div" className="text-sm">{meta.about}</Text>}
      {meta?.nip05 && (
        <Container as="dl" variant="row" gap={3} className="text-xs">
          <dt className="text-muted min-w-[60px] font-semibold">NIP-05</dt><dd className="text-body break-all">{meta.nip05}</dd>
        </Container>
      )}
      {meta?.lud16 && (
        <Container as="dl" variant="row" gap={3} className="text-xs">
          <dt className="text-muted min-w-[60px] font-semibold">Lightning</dt><dd className="text-body break-all">{meta.lud16}</dd>
        </Container>
      )}
      {meta?.website && (
        <Container as="dl" variant="row" gap={3} className="text-xs">
          <dt className="text-muted min-w-[60px] font-semibold">Website</dt><dd className="text-body break-all">{meta.website}</dd>
        </Container>
      )}
    </Card>

    <Text variant="muted" as="div" className="text-center">{t('profileEdit.previewHint')}</Text>

    <FormError>{error}</FormError>

    <Container variant="row" gap={4} className="mt-2">
      <Button className="flex-1" variant="secondary" onClick={onBack}>
        {t('common.back')}
      </Button>
      <Button className="flex-1" onClick={onConfirm}>{t('profileEdit.confirmPublish')}</Button>
    </Container>
  </Container>
  );
}
