import { t } from '@services/i18n/i18n.ts';
import IconCamera from '@assets/IconCamera.tsx';
import { safeImageUrl } from '@utils/safeUrl.ts';

/** Local previews are object URLs created by this editor; remote URLs are sanitized. */
export default function ProfileImageHeader({ banner, picture, bannerPreview, picturePreview, initial, onEdit }: {
  banner: string; picture: string; bannerPreview?: string | null; picturePreview?: string | null;
  initial: string; onEdit: (target: 'banner' | 'picture') => void;
}) {
  const cover = bannerPreview || safeImageUrl(banner);
  const avatar = picturePreview || safeImageUrl(picture);
  return <div className="flex flex-col items-center gap-5">
    <button type="button" aria-label={t('profileEdit.editCover')} onClick={() => onEdit('banner')}
      className="relative w-full h-[100px] p-0 rounded-md border border-control-border bg-input overflow-hidden cursor-pointer hover:border-brand focus-visible:shadow-focus focus-visible:outline-none">
      {cover && <img src={cover} alt="" className="w-full h-full object-cover" />}
      <span className="absolute bottom-4 right-4 inline-flex items-center gap-3 rounded-md px-4 py-3 bg-[rgba(0,0,0,0.45)] text-on-brand text-xs font-semibold">
        <IconCamera size={14} />{t('profileEdit.editCover')}
      </span>
    </button>
    <button type="button" aria-label={t('profileEdit.changeImage')} onClick={() => onEdit('picture')}
      className="relative w-40 h-40 p-0 rounded-full cursor-pointer overflow-hidden bg-brand-light flex items-center justify-center border-2 border-card-border hover:border-brand focus-visible:shadow-focus focus-visible:outline-none">
      {avatar ? <img src={avatar} alt="" className="w-full h-full object-cover" /> : <span className="text-display font-bold text-brand uppercase">{initial}</span>}
      <span className="absolute bottom-0 left-0 right-0 h-14 bg-[rgba(0,0,0,0.45)] flex items-center justify-center text-on-brand"><IconCamera size={14} /></span>
    </button>
  </div>;
}
