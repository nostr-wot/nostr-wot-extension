import React, { useState } from 'react';
import { safeImageUrl } from '@shared/safeUrl.js';

interface AvatarProps {
  src: string | null | undefined;
  fallback: string;
  imgClassName?: string;
  fallbackClassName?: string;
}

/**
 * Renders an <img> when `src` is set and hasn't errored; on load error (or when
 * `src` is empty) it renders a fallback <div> containing the `fallback` text.
 *
 * Each call site passes its own `imgClassName` / `fallbackClassName` so the
 * rendered markup and styling stay identical to the previous hand-rolled
 * versions — this is the correct pattern that was already in TopBar/AccountBar.
 */
export default function Avatar({ src, fallback, imgClassName, fallbackClassName }: AvatarProps) {
  const [imgError, setImgError] = useState<boolean>(false);
  // `src` is usually relay-supplied profile metadata — only render http(s) URLs.
  const safeSrc = safeImageUrl(src);
  const showImg = safeSrc && !imgError;

  if (showImg) {
    return (
      <img
        className={imgClassName}
        src={safeSrc}
        alt=""
        onError={() => setImgError(true)}
      />
    );
  }
  return <div className={fallbackClassName}>{fallback}</div>;
}
