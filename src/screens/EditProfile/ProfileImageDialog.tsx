import { useRef, useState } from 'react';
import { t } from '@services/i18n/i18n.ts';
import { safeImageUrl } from '@utils/safeUrl.ts';
import Modal from '@components/Modal';
import Input from '@components/Input';
import Button, { ButtonSecondary } from '@components/Button';
import FormError from '@components/FormError';
import Text from '@components/Text';

export type ProfileImageChoice = { url: string; file: File | null };

/** Both image controls edit a draft here. Only Save changes the profile form. */
export default function ProfileImageDialog({ target, url, file, onClose, onSave }: {
  target: 'picture' | 'banner'; url: string; file: File | null;
  onClose: () => void; onSave: (choice: ProfileImageChoice) => void;
}) {
  const [draftUrl, setDraftUrl] = useState(file ? '' : url);
  const [draftFile, setDraftFile] = useState(file);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const invalid = !draftFile && !!draftUrl.trim() && !safeImageUrl(draftUrl.trim());
  return <Modal title={target === 'banner' ? t('profileEdit.editCover') : t('profileEdit.changeImage')}
    onClose={onClose} zIndex={720} footerRow footer={<>
      <ButtonSecondary onClick={onClose}>{t('common.cancel')}</ButtonSecondary>
      <Button disabled={!!invalid || !!error} onClick={() => {
        if (!invalid && !error) onSave({url: draftFile ? '' : draftUrl.trim(), file: draftFile});
      }}>{t('common.save')}</Button>
    </>}>
    <div className="flex flex-col gap-5">
      <Input label={target === 'banner' ? t('profileEdit.bannerUrl') : t('profileEdit.pictureUrl')}
        placeholder="https://…" value={draftUrl} error={invalid ? t('profileEdit.invalidImageUrl') : undefined}
        onChange={e => { setDraftUrl(e.target.value); setDraftFile(null); setError(''); }} />
      <ButtonSecondary onClick={() => fileRef.current?.click()}>{t('profileEdit.uploadImage')}</ButtonSecondary>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => {
        const next = e.target.files?.[0];
        e.target.value = '';
        if (!next) return;
        if (!next.type.startsWith('image/') || !next.size) { setError(t('profileEdit.invalidImage')); return; }
        setDraftFile(next); setDraftUrl(''); setError('');
      }} />
      {draftFile && <Text variant="secondary" className="text-sm break-all">{draftFile.name}</Text>}
      <Text variant="hint">{t('profileEdit.imageUploadHint')}</Text>
      <FormError>{error}</FormError>
    </div>
  </Modal>;
}
