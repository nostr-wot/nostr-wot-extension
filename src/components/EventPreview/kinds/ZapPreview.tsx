import type { NostrEventDisplay } from '@domain/nostr/nostrEvent';
import { zapPreview } from '@domain/nostr/zapPreview';
import { t } from '@services/i18n/i18n';
import ApprovalAmount from '@components/ApprovalAmount';
import SenderProfile from '@components/EventDetailModal/SenderProfile';
import Container from '@components/Container';
import Text from '@components/Text';
import TextBlock from '@components/TextBlock';

export default function ZapPreview({event}:{event:NostrEventDisplay}) {
  const {amountMsats,recipient}=zapPreview(event);
  return <Container gap={4}>
    <ApprovalAmount amountMsats={amountMsats} label={t('zapReview.amount')}/>
    <Container gap={2}>
      <Text variant="secondary">{t('event.recipient')}</Text>
      {recipient ? <SenderProfile pubkey={recipient}/> : <Text variant="muted">{t('zapReview.recipientUnknown')}</Text>}
    </Container>
    {event.content && <Container gap={2}><Text variant="secondary">{t('zapReview.comment')}</Text><TextBlock>{event.content}</TextBlock></Container>}
    <Text variant="secondary">{t('zapReview.signingOnly')}</Text>
  </Container>;
}
