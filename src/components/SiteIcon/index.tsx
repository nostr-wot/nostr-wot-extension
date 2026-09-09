import { useEffect, useState } from 'react';
import IconGlobe from '@assets/IconGlobe.tsx';
import { getCachedFavicon } from '@services/media/favicon.ts';
import { cn } from '@utils/cn.ts';

/** Shared by site identity surfaces; all instances reuse the same favicon cache. */
export default function SiteIcon({ domain, className }: { domain?: string | null; className?: string }) {
  const [image, setImage] = useState<{ domain: string; url: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (domain) void getCachedFavicon(domain).then(url => {
      if (!cancelled) setImage(url ? { domain, url } : null);
    });
    return () => { cancelled = true; };
  }, [domain]);
  return <span aria-hidden="true" className={cn('inline-flex items-center justify-center w-14 h-14 shrink-0 rounded-sm bg-page-solid border border-card-border text-muted', className)}>
    {image?.domain === domain && image?.url
      ? <img src={image.url} alt="" referrerPolicy="no-referrer" className="w-9 h-9 object-contain" onError={() => setImage(null)} />
      : <IconGlobe size={16} />}
  </span>;
}
