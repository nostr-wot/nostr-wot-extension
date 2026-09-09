import ProfileSummary from '@components/ProfileSummary';
import { t } from '@services/i18n/i18n.ts';
import Button, { ButtonSecondary } from '@components/Button';
import { type ProfileMetadata } from '@domain/profile/profileMetadata.ts';
import FormError from '@components/FormError';
import Container from '@components/Container';
import Text from '@components/Text';

interface ProfilePreviewCardProps {
  meta: ProfileMetadata | null;
  initial: string;
  error: string;
  onBack: () => void;
  onConfirm: () => void;
}

/** What the profile will look like once published, and the confirm step. */
export default function ProfilePreviewCard({
  meta, initial, error, onBack, onConfirm,
}: ProfilePreviewCardProps) {
  return (
  <Container gap={7} className="flex-1 overflow-y-auto">
    <ProfileSummary meta={meta} initial={initial} />

    <Text variant="muted" as="div" className="text-center">{t('profileEdit.previewHint')}</Text>

    <FormError>{error}</FormError>

    <Container variant="row" gap={4} className="mt-2">
      <ButtonSecondary className="flex-1" onClick={onBack}>
        {t('common.back')}
      </ButtonSecondary>
      <Button className="flex-1" onClick={onConfirm}>{t('profileEdit.confirmPublish')}</Button>
    </Container>
  </Container>
  );
}
