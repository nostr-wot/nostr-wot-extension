import React from 'react';
import { t } from '@lib/i18n.js';
import { IconCopy } from '@assets';
import useCopy from '@hooks/useCopy.ts';
import { truncateMiddle } from '@shared/format/text.ts';

/** Label, shortened value, copy. Shortened in the MIDDLE so both ends stay
 *  checkable and the row stays one line. */
export default function KeyRow({ label, value }: { label: string; value: string }) {
  const { copy, copied, failed } = useCopy();
  return (
    <div className="flex items-baseline justify-between gap-5 py-4 border-t border-card-border text-sm">
      <span className="text-muted shrink-0">{label}</span>
      <code className="font-code text-xs text-heading break-all" title={value}>{truncateMiddle(value, 12, 10)}</code>
      {/* Not IconButton (icon-only, fixed square) or LinkButton (chromeless
          text, no hover surface): this pairs an icon with a conditional
          "Copied"/"Error" label inside a padded hover-background pill, a
          combination neither primitive's contract covers. */}
      <button
        className="flex items-center gap-2 shrink-0 bg-transparent border-none p-2 cursor-pointer text-muted text-xs rounded-sm hover:bg-card hover:text-body"
        onClick={() => copy(value)}
        aria-label={t('common.copy')}
        title={t('common.copy')}
      >
        <IconCopy size={12} />
        {copied ? t('common.copied') : failed ? t('common.error') : ''}
      </button>
    </div>
  );
}
