import Text from '@components/Text';
import Container from '@components/Container';
import { t, getLanguage } from '@services/i18n/i18n';
import { formatMsats } from '@domain/wallet/amount';

export default function ApprovalAmount({amountMsats,label}:{amountMsats:string|null;label:string}) {
  return <Container gap={1}>
    <Text variant="secondary">{label}</Text>
    {amountMsats ? <Text className="text-3xl font-semibold text-brand tabular-nums break-words">
      {formatMsats(amountMsats,getLanguage())} <span className="text-lg">sats</span>
    </Text> : <Text className="text-warning">{t('zapReview.amountUnknown')}</Text>}
  </Container>;
}
