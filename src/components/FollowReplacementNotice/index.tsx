import type { PendingRequest } from '@domain/signing/types.ts';
import { t } from '@services/i18n/i18n.ts';
import StatusNotice from '@components/StatusNotice';
import IconWarning from '@assets/IconWarning';

type FollowRequest = Pick<PendingRequest, 'followReplacementCount' | 'followReplacementNewCount'> & { origin?: string };

/** Keep the same warning visible in the queue and details, without repeating identical reductions. */
export default function FollowReplacementNotice({ requests, showTitle = true }: { requests: FollowRequest[]; showTitle?: boolean }) {
  const warnings = new Map<string, FollowRequest>();
  for (const request of requests) {
    if (request.followReplacementCount) {
      warnings.set(JSON.stringify([request.origin, request.followReplacementCount, request.followReplacementNewCount ?? 1]), request);
    }
  }
  return <>{[...warnings].map(([key, request]) => (
    <StatusNotice key={key} tone="error" icon={<IconWarning/>} variant="callout"
      label={showTitle ? t('approval.followReplacementTitle') : undefined}>
      {t('approval.followReplacementWarning', {
        origin: request.origin || '?', count: request.followReplacementCount!, newCount: request.followReplacementNewCount ?? 1,
      })}
    </StatusNotice>
  ))}</>;
}
