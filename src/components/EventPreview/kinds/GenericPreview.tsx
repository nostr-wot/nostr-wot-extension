import TextBlock from '@components/TextBlock';
import { KIND_LABELS } from '@constants/nostr.ts';
import type { NostrEventDisplay } from '@domain/nostr/nostrEvent.ts';
import Heading from '@components/Heading';

interface GenericPreviewProps {
  event: NostrEventDisplay;
}

export default function GenericPreview({ event }: GenericPreviewProps) {
  const kindLabel = KIND_LABELS[event.kind] || `Kind ${event.kind}`;
  return (
    <>
      <Heading level={5} as="h3" className="m-0 mb-4">{kindLabel}</Heading>
      {event.content && (
        <TextBlock>{event.content}</TextBlock>
      )}
    </>
  );
}
