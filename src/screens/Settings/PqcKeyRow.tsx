import { t } from '@services/i18n/i18n.ts';
import { truncateMiddle } from '@utils/format/text.ts';
import CopyButton from '@components/CopyButton/CopyButton';
import Container from '@components/Container/Container';

/** Label, shortened value, copy. Shortened in the MIDDLE so both ends stay
 *  checkable and the row stays one line. */
export default function KeyRow({ label, value }: { label: string; value: string }) {
  return (
    <Container gap={3} className="p-6 mb-4 border border-card-border rounded-md bg-input">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-semibold text-heading">{label.toUpperCase()}</span>
        <CopyButton value={value} label={`${t('common.copy')} ${label}`} />
      </div>
      <code className="font-code text-xs text-secondary break-all" title={value}>{truncateMiddle(value, 20, 16)}</code>
    </Container>
  );
}
