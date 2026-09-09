import React, { useState, useRef, useEffect, ChangeEvent } from 'react';
import { t } from '@lib/i18n.js';
import { rpc } from '@services/rpc.ts';
import { uploadProfileImages } from '@services/blossom.ts';
import { safeImageUrl } from '@utils/safeUrl.ts';
import {
  mergeProfileMetadata,
  profileHasChanges,
  type ProfileMetadata,
} from '@domain/profile/profileMetadata.ts';
import { useAccount } from '@context/AccountContext';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import ProfilePreviewCard from './ProfilePreviewCard';
import ProfileImageHeader from './ProfileImageHeader';
import ProfileImageDialog, { type ProfileImageChoice } from './ProfileImageDialog';
import Textarea from '@components/Textarea/Textarea';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import LinkButton from '@components/LinkButton/LinkButton';
import Spinner from '@components/Spinner/Spinner';
import { useAnimatedVisible } from '@hooks/useAnimatedVisible.ts';
import { IconChevronDown } from '@assets';
import FormError from '@components/FormError/FormError';
import Container from '@components/Container/Container';
import Text from '@components/Text/Text';

const STEPS = { FORM: 0, UPLOADING: 1, PREVIEW: 2, PUBLISHING: 3, DONE: 4 } as const;
type StepValue = typeof STEPS[keyof typeof STEPS];

interface EditProfileOverlayProps {
  visible: boolean;
  onClose: () => void;
}

export default function EditProfileOverlay({ visible, onClose }: EditProfileOverlayProps) {
  const { active, cachedProfile, reload } = useAccount();
  const bannerBlobRef = useRef<string | null>(null);
  const uploadedImagesRef = useRef(new WeakMap<File, string>());
  const operation = useRef(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const [editingImage, setEditingImage] = useState<'picture' | 'banner' | null>(null);
  const [step, setStep] = useState<StepValue>(STEPS.FORM);
  const [name, setName] = useState<string>('');
  const [about, setAbout] = useState<string>('');
  const [picture, setPicture] = useState<string>('');
  const [nip05, setNip05] = useState<string>('');
  const [lud16, setLud16] = useState<string>('');
  const [website, setWebsite] = useState<string>('');
  const [banner, setBanner] = useState<string>('');
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<ProfileMetadata | null>(null);
  const [error, setError] = useState<string>('');

  // Pre-fill from cachedProfile on open
  useEffect(() => {
    operation.current++;
    if (!visible) return;
    if (cachedProfile) {
      setName(cachedProfile.name || cachedProfile.display_name || '');
      setAbout(cachedProfile.about || '');
      setPicture(cachedProfile.picture || '');
      setNip05(cachedProfile.nip05 || '');
      setLud16(cachedProfile.lud16 || '');
      setWebsite(cachedProfile.website || '');
      setBanner(cachedProfile.banner || '');
    } else {
      setName(''); setAbout(''); setPicture(''); setNip05('');
      setLud16(''); setWebsite(''); setBanner('');
    }
    setEditingImage(null);
    setBannerFile(null); setBannerPreview(null);
    uploadedImagesRef.current = new WeakMap();
    if (bannerBlobRef.current) { URL.revokeObjectURL(bannerBlobRef.current); bannerBlobRef.current = null; }
    setImageFile(null); setImagePreview(null); setError('');
    setStep(STEPS.FORM); setAdvancedOpen(false); setPreviewMeta(null);
    // Revoke old blob URL
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
  }, [visible, active?.id]);

  // Cleanup on unmount
  useEffect(() => {
    const lifetime = operation;
    return () => {
      lifetime.current++;
      if (bannerBlobRef.current) URL.revokeObjectURL(bannerBlobRef.current);
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const { shouldRender, animating } = useAnimatedVisible(visible);

  if (!shouldRender) return null;

  const initial = (name || active?.name || '?')[0]?.toUpperCase();
  const formFields = { name, about, picture, nip05, lud16, website, banner };
  const hasChanges = profileHasChanges(cachedProfile, formFields, imageFile !== null || bannerFile !== null);
  const bannerInvalid = !bannerFile && !!banner.trim() && !safeImageUrl(banner.trim());
  const pictureInvalid = !imageFile && !!picture.trim() && !safeImageUrl(picture.trim());
  const formValid = !!(name.trim() || about.trim()) && !bannerInvalid && !pictureInvalid;

  const applyImage = (target: 'picture' | 'banner', choice: ProfileImageChoice) => {
    const ref = target === 'banner' ? bannerBlobRef : blobUrlRef;
    if (ref.current) URL.revokeObjectURL(ref.current);
    const preview = choice.file ? URL.createObjectURL(choice.file) : null;
    ref.current = preview;
    if (target === 'banner') { setBanner(choice.url); setBannerFile(choice.file); setBannerPreview(preview); }
    else { setPicture(choice.url); setImageFile(choice.file); setImagePreview(preview); }
    setError(''); setEditingImage(null);
  };

  const handlePublish = async () => {
    if (!formValid || !hasChanges || step !== STEPS.FORM) return;
    setError('');
    const current = ++operation.current;
    try {
      if (imageFile || bannerFile) setStep(STEPS.UPLOADING);
      const urls = await uploadProfileImages({ picture: imageFile, banner: bannerFile }, uploadedImagesRef.current);
      if (operation.current !== current) return;
      const metadata = mergeProfileMetadata(cachedProfile, {
        ...formFields, picture: urls.picture || picture.trim(), banner: urls.banner || banner.trim(),
      });
      setPreviewMeta(metadata);
      if (urls.picture) setPicture(urls.picture);
      if (urls.banner) setBanner(urls.banner);
      setStep(STEPS.PREVIEW);
    } catch (err: any) {
      if (operation.current !== current) return;
      setError(err.message || t('profileEdit.uploadFailed'));
      setStep(STEPS.FORM);
    }
  };

  const handleConfirmPublish = async () => {
    setStep(STEPS.PUBLISHING);
    setError('');
    try {
      const event = {
        created_at: Math.floor(Date.now() / 1000),
        kind: 0,
        tags: [] as string[][],
        content: JSON.stringify(previewMeta),
      };
      await rpc('signAndPublishEvent', { event });
      await rpc('updateProfileCache', { pubkey: active!.pubkey, metadata: previewMeta });
      reload();
      setStep(STEPS.DONE);
      closeTimerRef.current = setTimeout(() => onClose(), 1500);
    } catch (err: any) {
      setError(err.message || t('profileEdit.publishFailed'));
      setStep(STEPS.PREVIEW);
    }
  };

  const renderForm = () => (
    <Container gap={7} className="flex-1 overflow-y-auto">
      <ProfileImageHeader banner={banner} picture={picture} bannerPreview={bannerPreview} picturePreview={imagePreview}
        initial={initial} onEdit={setEditingImage} />

      <Container gap={6}>
        <Input
          label={t('profileEdit.displayName')}
          placeholder={t('profileEdit.namePlaceholder')}
          value={name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
        />
        <Textarea
          label={t('profileEdit.about')}
          placeholder={t('profileEdit.aboutPlaceholder')}
          value={about}
          onChange={e => setAbout(e.target.value)}
        />

        <LinkButton
          className="flex items-center gap-3 text-sm font-semibold text-secondary py-2"
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          <IconChevronDown size={14} className={`transition-transform duration-slow ${advancedOpen ? 'rotate-180' : ''}`} />
          {t('profileEdit.advanced')}
        </LinkButton>

        {advancedOpen && (
          <Container gap={6}>
            <Input
              label={t('profileEdit.nip05')}
              placeholder={t('profileEdit.nip05Placeholder')}
              value={nip05}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNip05(e.target.value)}
            />
            <Input
              label={t('profileEdit.lightning')}
              placeholder={t('profileEdit.lightningPlaceholder')}
              value={lud16}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setLud16(e.target.value)}
            />
            <Input
              label={t('profileEdit.website')}
              placeholder={t('profileEdit.websitePlaceholder')}
              value={website}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setWebsite(e.target.value)}
            />

          </Container>
        )}
      </Container>

      <FormError>{error}</FormError>

      <Container variant="row" gap={4} className="mt-2">
        <Button className="flex-1" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button className="flex-1" onClick={handlePublish} disabled={!hasChanges || !formValid}>{t('profileEdit.publish')}</Button>
      </Container>
    </Container>
  );

  const renderUploading = () => (
    <Container gap={7} className="flex-1 overflow-y-auto">
      <Container gap={5} className="items-center justify-center py-12">
        <Spinner size={28} />
        <Text as="span" className="font-semibold">{t('profileEdit.uploading')}</Text>
      </Container>
    </Container>
  );

  const renderPreview = () => (
    <ProfilePreviewCard
      meta={previewMeta}
      initial={initial}
      error={error}
      onBack={() => { setStep(STEPS.FORM); setError(''); }}
      onConfirm={handleConfirmPublish}
    />
  );

  const renderPublishing = () => (
    <Container gap={7} className="flex-1 overflow-y-auto">
      <Container gap={5} className="items-center justify-center py-12">
        <Spinner size={28} />
        <Text as="span" className="font-semibold">{t('common.publishing')}</Text>
      </Container>
    </Container>
  );

  const renderDone = () => (
    <Container gap={7} className="flex-1 overflow-y-auto">
      <Container gap={5} className="items-center justify-center py-12">
        <span className="text-lg font-bold text-success">{t('profileEdit.published')}</span>
      </Container>
    </Container>
  );

  const stepContent: Record<StepValue, () => React.ReactNode> = {
    [STEPS.FORM]: renderForm,
    [STEPS.UPLOADING]: renderUploading,
    [STEPS.PREVIEW]: renderPreview,
    [STEPS.PUBLISHING]: renderPublishing,
    [STEPS.DONE]: renderDone,
  };

  return (
    <OverlayPanel
      title={t('profileEdit.title')}
      onClose={step === STEPS.PREVIEW ? onClose : undefined}
      onBack={
        step === STEPS.PUBLISHING ? null
          : step === STEPS.PREVIEW ? () => { setStep(STEPS.FORM); setError(''); }
            : onClose
      }
      animating={animating}
    >
      {(stepContent[step] || renderForm)()}
      {editingImage && <ProfileImageDialog target={editingImage}
        url={editingImage === 'banner' ? banner : picture} file={editingImage === 'banner' ? bannerFile : imageFile}
        onClose={() => setEditingImage(null)} onSave={choice => applyImage(editingImage, choice)} /> }
    </OverlayPanel>
  );
}
