import { useEffect, useState } from 'react';
import { createObjectUrlResource } from '@services/media/objectUrl.ts';

/** Revoke previews on file replacement, scope change and unmount. No URL is created during render. */
export default function useObjectUrl(blob: Blob | null, scope: unknown = null) {
  const [preview, setPreview] = useState<{ blob: Blob; scope: unknown; url: string } | null>(null);
  useEffect(() => {
    if (!blob) { setPreview(null); return; }
    const resource = createObjectUrlResource(blob);
    setPreview({ blob, scope, url: resource.url });
    return resource.dispose;
  }, [blob, scope]);
  return preview?.blob === blob && preview.scope === scope ? preview.url : null;
}
