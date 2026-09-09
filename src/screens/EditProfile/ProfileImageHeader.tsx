import { t } from '@services/i18n/i18n.ts';
import Container from '@components/Container';
import ImageEditorButton from '@components/ImageEditorButton';

/** Local previews are object URLs created by this editor; remote URLs are sanitized. */
export default function ProfileImageHeader({ banner, picture, bannerPreview, picturePreview, initial, onEdit }: {
  banner: string; picture: string; bannerPreview?: string | null; picturePreview?: string | null;
  initial: string; onEdit: (target: 'banner' | 'picture') => void;
}) {
  return <Container gap={5} className="items-center">
    <ImageEditorButton variant="cover" label={t('profileEdit.editCover')} src={banner}
      previewUrl={bannerPreview} onClick={() => onEdit('banner')} />
    <ImageEditorButton variant="avatar" label={t('profileEdit.changeImage')} src={picture}
      previewUrl={picturePreview} fallback={initial} onClick={() => onEdit('picture')} />
  </Container>;
}
