import { t } from '@services/i18n/i18n.ts';
import useCopy from '@hooks/useCopy.ts';
import IconCopy from '@assets/IconCopy.tsx';
import IconButton from '@components/IconButton';
import { ButtonSecondary } from '@components/Button';
import ScreenReaderStatus from '@components/ScreenReaderStatus';

interface CopyButtonProps {
  value: string;
  label: string;
  iconOnly?: boolean;
  disabled?: boolean;
}

/** Clipboard feedback and accessible naming shared by compact and labelled actions. */
export default function CopyButton({ value, label, iconOnly = false, disabled = false }: CopyButtonProps) {
  const { copy, copied, failed } = useCopy();
  const feedback = copied ? t('common.copied') : failed ? t('common.error') : '';
  return <span className="flex items-center gap-2 shrink-0">
    {iconOnly ? (
      <IconButton tone="brand" disabled={disabled} title={feedback || label} aria-label={feedback || label}
        onClick={() => void copy(value)}><IconCopy size={16} /></IconButton>
    ) : (
      <ButtonSecondary small disabled={disabled} aria-label={label} onClick={() => void copy(value)}>
        <IconCopy size={14} />{feedback || t('common.copy')}
      </ButtonSecondary>
    )}
    <ScreenReaderStatus>{feedback}</ScreenReaderStatus>
  </span>;
}
