import { t } from '@services/i18n/i18n.ts';
import IconCopy from '@assets/IconCopy.tsx';
import useCopy from '@hooks/useCopy.ts';
import { truncateMiddle } from '@utils/format/text.ts';
import Button from '@components/Button/Button';
import Container from '@components/Container/Container';

/** Label, shortened value, copy. Shortened in the MIDDLE so both ends stay
 *  checkable and the row stays one line. */
export default function KeyRow({ label, value }: { label: string; value: string }) {
  const { copy, copied, failed } = useCopy();
  return (
    <Container gap={3} className="p-6 mb-4 border border-card-border rounded-md bg-input">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-semibold text-heading">{label.toUpperCase()}</span>
        <Button small variant="secondary" onClick={() => copy(value)} aria-label={`${t('common.copy')} ${label}`}>
          <IconCopy size={14} />{copied ? t('common.copied') : failed ? t('common.error') : t('common.copy')}
        </Button>
      </div>
      <code className="font-code text-xs text-secondary break-all" title={value}>{truncateMiddle(value, 20, 16)}</code>
    </Container>
  );
}
