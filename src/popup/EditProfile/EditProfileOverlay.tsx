import React, { useState, useRef, useEffect, ChangeEvent } from 'react';
import { t } from '@lib/i18n.js';
import { rpc } from '@shared/rpc.ts';
import { uploadToBlossom } from '@shared/blossom.ts';
import { safeImageUrl } from '@shared/safeUrl.ts';
import {
  mergeProfileMetadata,
  profileHasChanges,
  type ProfileMetadata,
} from '@shared/profileMetadata.ts';
import { useAccount } from '@popup/context/AccountContext';
import OverlayPanel from '@components/OverlayPanel/OverlayPanel';
import Avatar from '@components/Avatar/Avatar';
import ProfilePreviewCard from './ProfilePreviewCard';
import Input from '@components/Input/Input';
import Button from '@components/Button/Button';
import LinkButton from '@components/LinkButton/LinkButton';
import Spinner from '@components/Spinner/Spinner';
import { useAnimatedVisible } from '@hooks/useAnimatedVisible.ts';
import { IconCamera, IconChevronDown } from '@assets';
import styles from './EditProfileOverlay.module.css';
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
    <div className={styles.body}>
      <div className={styles.avatarPicker}>
        <button type="button" className={styles.avatarCircle} onClick={() => fileRef.current?.click()}>
          {displayPicture ? (
            <img src={displayPicture} alt="" className={styles.avatarImg} />
          ) : (
            <span className={styles.avatarPlaceholder}>{initial}</span>
          )}
          <div className={styles.cameraOverlay}>
            <IconCamera size={14} />
          </div>
        </button>
        <span className={styles.avatarHint}>
          {displayPicture ? t('profileEdit.changeImage') : t('profileEdit.uploadImage')}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className={styles.hiddenInput}
          onChange={handleFilePick}
        />
      </div>

      <div className={styles.form}>
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
          className={styles.advancedToggle}
          data-open={advancedOpen}
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          <IconChevronDown size={14} />
          {t('profileEdit.advanced')}
        </LinkButton>

        {advancedOpen && (
          <div className={styles.advancedFields}>
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

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={handlePublish} disabled={!hasChanges}>{t('profileEdit.publish')}</Button>
      </div>
    </div>
  );

  const renderUploading = () => (
    <div className={styles.body}>
      <div className={styles.statusRow}>
        <Spinner size={28} />
        <span className={styles.statusText}>{t('profileEdit.uploading')}</span>
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
    <div className={styles.body}>
      <div className={styles.statusRow}>
        <Spinner size={28} />
        <span className={styles.statusText}>{t('common.publishing')}</span>
      </div>
    </div>
  );

  const renderDone = () => (
    <div className={styles.body}>
      <div className={styles.statusRow}>
        <span className={styles.successText}>{t('profileEdit.published')}</span>
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
