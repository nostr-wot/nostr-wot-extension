import { t } from '@lib/i18n.js';
import Button from '@components/Button/Button';

const ROW = 'flex items-center justify-between gap-4 py-4 mt-2';
const INFO = 'text-xs text-muted';
const TONE: Record<string, string> = {
  unsaved: 'text-warning font-medium',
  success: 'text-success font-medium',
  error: 'text-error font-medium',
};
// Same shape as Spinner (border ring + animate-spin), inlined rather than
// reused: this one is fixed at 14px with no caller-configurable size.
const SPINNER = 'w-[14px] h-[14px] rounded-full border-2 border-card-border border-t-brand animate-spin ' +
  '[animation-duration:0.7s] shrink-0';

interface PublishRowLabels {
  idle: string;
  unsaved: string;
  success: string;
  error: string;
  publishing: string;
}

interface PublishRowProps {
  publishing: boolean;
  status: 'success' | 'error' | null;
  dirty: boolean;
  labels: PublishRowLabels;
  onPublish: () => void;
}

/**
 * Shared "publish status text + spinner + Publish button" row used by the
 * relay list (NetworkSection) and the mute list (FiltersOverlay). The status
 * text is a 4-way choice: publishing → success → error → (dirty ? unsaved :
 * idle). The `idle` label is precomputed by the caller (it may itself depend
 * on last-published time / never-published state).
 */
export default function PublishRow({ publishing, status, dirty, labels, onPublish }: PublishRowProps) {
  const tone = status === 'success' ? TONE.success : status === 'error' ? TONE.error : dirty ? TONE.unsaved : '';
  const infoClass = `${INFO} ${tone}`;

  const statusText = publishing
    ? labels.publishing
    : status === 'success'
      ? labels.success
      : status === 'error'
        ? labels.error
        : dirty
          ? labels.unsaved
          : labels.idle;

  return (
    <div className={ROW}>
      <span className={infoClass}>{statusText}</span>
      {publishing && <div className={SPINNER} />}
      <Button small variant="secondary" onClick={onPublish} disabled={publishing}>{t('common.publish')}</Button>
    </div>
  );
}
