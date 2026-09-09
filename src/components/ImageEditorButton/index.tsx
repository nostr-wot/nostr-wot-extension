import IconCamera from '@assets/IconCamera.tsx';
import { safeImageUrl } from '@utils/safeUrl.ts';
import { cn } from '@utils/cn.ts';

interface ImageEditorButtonProps {
  variant: 'cover' | 'avatar';
  label: string;
  src?: string;
  /** Only local object URLs belong here; remote URLs go through src. */
  previewUrl?: string | null;
  fallback?: string;
  onClick: () => void;
}

const BASE = 'relative p-0 overflow-hidden cursor-pointer border border-control-border hover:border-brand focus-visible:shadow-focus focus-visible:outline-none';
const SHAPE = {
  cover: 'w-full h-[100px] rounded-md bg-input',
  avatar: 'w-40 h-40 rounded-full bg-brand-light flex items-center justify-center',
};
const CAPTION = {
  cover: 'bottom-4 right-4 gap-3 rounded-md px-4 py-3 text-xs font-semibold',
  avatar: 'bottom-0 left-0 right-0 h-14',
};

/** A clickable image preview with two standard shapes and one editing affordance. */
export default function ImageEditorButton({ variant, label, src, previewUrl, fallback, onClick }: ImageEditorButtonProps) {
  const image = previewUrl?.startsWith('blob:') ? previewUrl : safeImageUrl(src);
  return <button type="button" aria-label={label} onClick={onClick} className={cn(BASE, SHAPE[variant])}>
    {image ? <img src={image} alt="" className="w-full h-full object-cover" />
      : variant === 'avatar' && <span className="text-display font-bold text-brand uppercase">{fallback}</span>}
    <span aria-hidden="true" className={cn('absolute flex items-center justify-center bg-scrim text-on-brand', CAPTION[variant])}>
      <IconCamera size={14} />{variant === 'cover' && label}
    </span>
  </button>;
}
