import { t } from '@lib/i18n.js';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import FieldDisplay from '@components/FieldDisplay/FieldDisplay';
import { EP } from '../eventPreviewClasses.ts';

interface AppSpecificPreviewProps {
  event: NostrEventDisplay;
}

export default function AppSpecificPreview({ event }: AppSpecificPreviewProps) {
  const dTag = event.tags?.find((tag) => tag[0] === 'd');
  const app = dTag?.[1] || 'Unknown app';
  const action = dTag?.[2];
  return (
    <>
      <h3 className={EP.sectionTitle}>{t('event.kind')} 30078</h3>
      <FieldDisplay label="App" value={app} />
      {action && <FieldDisplay label="Action" value={action.replace(/_/g, ' ')} />}
    </>
  );
}
