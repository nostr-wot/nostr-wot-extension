import type { ChangeEvent } from 'react';
import { t } from '@services/i18n/i18n.ts';
import { invoiceExpiryLabel } from '@services/i18n/paymentLabels.ts';
import { isLightningAddress } from '@domain/wallet/lnurl.ts';
import type { ResolvedAddress } from '@domain/wallet/paymentPreview.ts';
import type { SendTarget } from '@domain/wallet/sendTarget.ts';
import type { decodeBolt11 } from '@domain/wallet/bolt11.ts';
import Input from '@components/Input';
import FieldDisplay from '@components/FieldDisplay';
import Container from '@components/Container';
import Text from '@components/Text';

interface PaymentPreviewProps {
  sendInput: string;
  sendIsAddress: boolean;
  sendAddress: ResolvedAddress | null;
  resolveLoading: boolean;
  resolveError: string;
  sendAmount: string;
  sendComment: string;
  sendTarget: SendTarget;
  decodedInvoice: ReturnType<typeof decodeBolt11>;
  setSendAmount: (value: string) => void;
  setSendComment: (value: string) => void;
}

/** Confirmation fields only; resolution and payment remain owned by SendDialog. */
export default function PaymentPreview({sendInput, sendIsAddress, sendAddress, resolveLoading,
  resolveError, sendAmount, sendComment, sendTarget, decodedInvoice, setSendAmount, setSendComment}: PaymentPreviewProps) {
  return <>
    {/* Lightning Address preview + amount */}
    {sendIsAddress && (
      resolveLoading ? (
        <Container variant="box">
          <span className="text-xs font-semibold text-muted uppercase tracking-[0.3px] shrink-0">{t('wallet.resolvingAddress')}</span>
        </Container>
      ) : sendAddress ? (
        <>
          <Container variant="box">
            <FieldDisplay caps className="py-0" label={t('wallet.payTo')} value={isLightningAddress(sendAddress.address) ? sendAddress.address : sendAddress.domain} />
            {sendAddress.description && (
              <FieldDisplay caps className="py-0" label={t('wallet.invoiceDescription')} value={sendAddress.description} />
            )}
            <FieldDisplay
              caps
              className="py-0"
              label={t('wallet.addressRange')}
              value={t('wallet.addressRangeValue', {
                min: sendAddress.minSats.toLocaleString(),
                max: sendAddress.maxSats.toLocaleString(),
              })}
            />
          </Container>
          <Input
            type="number"
            label={t('wallet.amountSats')}
    min={1} step={1}
    placeholder={t('wallet.amountSats')}
            value={sendAmount}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setSendAmount(e.target.value)}
            small
          />
          {sendAddress.commentAllowed > 0 && (
            <Input
              type="text"
              placeholder={t('wallet.commentPlaceholder')}
              value={sendComment}
              maxLength={sendAddress.commentAllowed}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSendComment(e.target.value)}
              small
            />
          )}
          {sendAmount !== '' && sendTarget.kind === 'none' && sendTarget.reason === 'amount' && (
            <Text variant="muted" as="div" className="text-center py-3">
              {t('wallet.amountOutOfRange', {
                min: sendAddress.minSats.toLocaleString(),
                max: sendAddress.maxSats.toLocaleString(),
              })}
            </Text>
          )}
        </>
      ) : resolveError ? (
        <Text variant="muted" as="div" className="text-center py-3">{resolveError}</Text>
      ) : null
    )}

    {/* Invoice preview */}
    {sendInput.trim() && !sendIsAddress && (
      decodedInvoice ? (
        <Container variant="box">
          <FieldDisplay
            caps
            className="py-0"
            valueClassName="text-xl font-bold"
            label={t('wallet.invoiceAmount')}
            value={decodedInvoice.amountSats !== null
              ? `${Math.round(decodedInvoice.amountSats).toLocaleString()} sats`
              : '—'}
          />
          <FieldDisplay
            caps
            className="py-0"
            label={t('wallet.invoiceDescription')}
            value={decodedInvoice.description || t('wallet.invoiceNone')}
          />
          <FieldDisplay
            caps
            className="py-0"
            label={t('wallet.invoiceExpiry')}
            value={invoiceExpiryLabel(decodedInvoice)}
          />
        </Container>
      ) : (
        <Text variant="muted" as="div" className="text-center py-3">{t('wallet.decodeFailed')}</Text>
      )
    )}

  </>;
}
