import { t } from '@services/i18n/i18n.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import FieldDisplay from '@components/FieldDisplay';
import Heading from '@components/Heading';

interface AppSpecificPreviewProps {
  event: NostrEventDisplay;
}

export default function AppSpecificPreview({ event }: AppSpecificPreviewProps) {
  const dTag = event.tags?.find((tag) => tag[0] === 'd');
  const app = dTag?.[1] || 'Unknown app';
  const action = dTag?.[2];
  return (
    <>
      <Heading level={5} as="h3" className="m-0 mb-4">{t('event.kind')} 30078</Heading>
      <FieldDisplay label="App" value={app} />
      {action && <FieldDisplay label="Action" value={action.replace(/_/g, ' ')} />}
    </>
  );
}
