import ApprovalAmount from '@components/ApprovalAmount';
import Container from '@components/Container';
import Text from '@components/Text';
import { paymentMsats } from '@domain/wallet/amount';
import { t } from '@services/i18n/i18n';

export default function WalletRequestPreview({type,walletAmount}:{type:string;walletAmount?:number}) {
  return <Container gap={4}>
    {type === 'webln_sendPayment' && <ApprovalAmount amountMsats={paymentMsats(walletAmount)} label={t('walletReview.amount')}/>}
    <Text variant="secondary">{t(type === 'webln_sendPayment' ? 'walletReview.paymentEffect' : 'walletReview.accessEffect')}</Text>
  </Container>;
}
