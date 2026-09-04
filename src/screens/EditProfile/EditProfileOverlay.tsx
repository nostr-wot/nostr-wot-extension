import React, { useState, useRef, useEffect, ChangeEvent } from 'react';
import { t } from '@lib/i18n.js';
import { rpc } from '@services/rpc.ts';
import { uploadToBlossom } from '@services/blossom.ts';
import { safeImageUrl } from '@utils/safeUrl.ts';
import {
  mergeProfileMetadata,
  profileHasChanges,
  type ProfileMetadata,
} from '@domain/profile/profileMetadata.ts';
import { useAccount } from '@context/AccountContext';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import Avatar from '@components/Avatar/Avatar';
import ProfilePreviewCard from './ProfilePreviewCard';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import LinkButton from '@components/LinkButton/LinkButton';
import Spinner from '@components/Spinner/Spinner';
import { useAnimatedVisible } from '@hooks/useAnimatedVisible.ts';
import { IconCamera, IconChevronDown } from '@assets';
import FormError from '@components/FormError/FormError';

const STEPS = { FORM: 0, UPLOADING: 1, PREVIEW: 2, PUBLISHING: 3, DONE: 4 } as const;
type StepValue = typeof STEPS[keyof typeof STEPS];

interface EditProfileOverlayProps {
  visible: boolean;
  onClose: () => void;
}

export default function EditProfileOverlay({ visible, onClose }: EditProfileOverlayProps) {
  const { active, cachedProfile, reload } = useAccount();
  const fileRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const [step, setStep] = useState<StepValue>(STEPS.FORM);
  const [name, setName] = useState<string>('');
  const [about, setAbout] = useState<string>('');
  const [picture, setPicture] = useState<string>('');
  const [nip05, setNip05] = useState<string>('');
  const [lud16, setLud16] = useState<string>('');
  const [website, setWebsite] = useState<string>('');
  const [banner, setBanner] = useState<string>('');
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [previewMeta, setPreviewMeta] = useState<ProfileMetadata | null>(null);
  const [error, setError] = useState<string>('');

  // Pre-fill from cachedProfile on open
  useEffect(() => {
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
    setImageFile(null); setImagePreview(null); setError('');
    setStep(STEPS.FORM); setAdvancedOpen(false); setPreviewMeta(null);
    // Revoke old blob URL
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
  }, [visible]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const { shouldRender, animating } = useAnimatedVisible(visible);

  if (!shouldRender) return null;

  const initial = (name || active?.name || '?')[0]?.toUpperCase();
  // imagePreview is a locally-created blob: URL (trusted); `picture` comes from
  // relay-supplied profile metadata, so only render it if it's plain http(s).
  const displayPicture = imagePreview || safeImageUrl(picture) || null;

  const formFields = { name, about, picture, nip05, lud16, website, banner };
  const hasChanges = profileHasChanges(cachedProfile, formFields, imageFile !== null);

  const handleFilePick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    // Revoke previous blob URL
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const url = URL.createObjectURL(file);
    blobUrlRef.current = url;
    setImagePreview(url);
  };

  const buildMetadata = (pictureUrl?: string | null): ProfileMetadata =>
    mergeProfileMetadata(cachedProfile, formFields, pictureUrl);

  const handlePublish = async () => {
    if (!name && !about) {
      setError(t('profileEdit.fillOneField'));
      return;
    }
    setError('');

    let uploadedUrl: string | null = null;
    try {
      if (imageFile) {
        setStep(STEPS.UPLOADING);
        const result = await uploadToBlossom(imageFile);
        uploadedUrl = result.url;
      }

      const metadata = buildMetadata(uploadedUrl);
      setPreviewMeta(metadata);
      setPicture(uploadedUrl || picture);
      setStep(STEPS.PREVIEW);
    } catch (err: any) {
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
    <div className="flex-1 overflow-y-auto flex flex-col gap-7">
      <div className="flex flex-col items-center gap-3 mb-2">
        <button
          type="button"
          className="relative w-40 h-40 p-0 font-[inherit] rounded-full cursor-pointer overflow-hidden bg-brand-light flex items-center justify-center border-2 border-card-border transition-colors duration-slow hover:border-brand"
          onClick={() => fileRef.current?.click()}
        >
          {displayPicture ? (
            <img src={displayPicture} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-display font-bold text-brand uppercase">{initial}</span>
          )}
          <div className="absolute bottom-0 left-0 right-0 h-14 bg-[rgba(0,0,0,0.45)] flex items-center justify-center text-on-brand">
            <IconCamera size={14} />
          </div>
        </button>
        <span className="text-xs text-muted">
          {displayPicture ? t('profileEdit.changeImage') : t('profileEdit.uploadImage')}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFilePick}
        />
      </div>

      <div className="flex flex-col gap-6">
        <Input
          label={t('profileEdit.displayName')}
          placeholder={t('profileEdit.namePlaceholder')}
          value={name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
        />
        <Input
          label={t('profileEdit.about')}
          placeholder={t('profileEdit.aboutPlaceholder')}
          value={about}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setAbout(e.target.value)}
        />

        <LinkButton
          className="flex items-center gap-3 text-sm font-semibold text-secondary py-2"
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          <IconChevronDown size={14} className={`transition-transform duration-slow ${advancedOpen ? 'rotate-180' : ''}`} />
          {t('profileEdit.advanced')}
        </LinkButton>

        {advancedOpen && (
          <div className="flex flex-col gap-6">
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
            <Input
              label={t('profileEdit.banner')}
              placeholder={t('profileEdit.bannerPlaceholder')}
              value={banner}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setBanner(e.target.value)}
            />
          </div>
        )}
      </div>

      <FormError>{error}</FormError>

      <div className="flex gap-4 mt-2">
        <Button className="flex-1" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button className="flex-1" onClick={handlePublish} disabled={!hasChanges}>{t('profileEdit.publish')}</Button>
      </div>
    </div>
  );

  const renderUploading = () => (
    <div className="flex-1 overflow-y-auto flex flex-col gap-7">
      <div className="flex flex-col items-center justify-center gap-5 py-12">
        <Spinner size={28} />
        <span className="text-md text-body font-semibold">{t('profileEdit.uploading')}</span>
      </div>
    </div>
  );

  const renderPreview = () => (
    <ProfilePreviewCard
      meta={previewMeta}
      displayPicture={displayPicture}
      initial={initial}
      error={error}
      onBack={() => { setStep(STEPS.FORM); setError(''); }}
      onConfirm={handleConfirmPublish}
    />
  );

  const renderPublishing = () => (
    <div className="flex-1 overflow-y-auto flex flex-col gap-7">
      <div className="flex flex-col items-center justify-center gap-5 py-12">
        <Spinner size={28} />
        <span className="text-md text-body font-semibold">{t('common.publishing')}</span>
      </div>
    </div>
  );

  const renderDone = () => (
    <div className="flex-1 overflow-y-auto flex flex-col gap-7">
      <div className="flex flex-col items-center justify-center gap-5 py-12">
        <span className="text-lg font-bold text-success">{t('profileEdit.published')}</span>
      </div>
    </div>
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
    </OverlayPanel>
  );
}
