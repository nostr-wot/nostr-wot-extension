import { useState } from 'react';
import { rpc } from '@services/rpc.ts';
import { t } from '@services/i18n/i18n.ts';
import useAsyncResource from '@hooks/useAsyncResource.ts';
import useStorageWatch from '@hooks/useStorageWatch.ts';
import { paymentRecordsKey, type PaymentNotice } from '@domain/wallet/payment-records.ts';
import { formatSats } from '@domain/wallet/display.ts';
import Modal from '@components/Modal';
import Button from '@components/Button';
import Container from '@components/Container';
import Text from '@components/Text';
import FormError from '@components/FormError';

export function PaymentReceipt({ notice }: { notice: PaymentNotice }) {
  return <Container gap={4} className="text-center" role="status">
    <div className="text-[48px] leading-none text-success" aria-hidden="true">✓</div>
    <Text className="text-lg font-semibold text-success">{t('wallet.paymentSent')}</Text>
    {notice.amount > 0 && <div className="text-2xl text-success">{formatSats(notice.amount)}</div>}
    <Text className="break-all">{notice.origin}</Text>
    <Text variant="hint">{new Date(notice.timestamp).toLocaleString()}</Text>
  </Container>;
}

/** Mounted only for the unlocked account; receipts survive a closed popup. */
export default function PaymentSuccessNotice({ accountId }: { accountId: string }) {
  const { data, refresh } = useAsyncResource<{ items: PaymentNotice[] }>({ items: [] }, {
    load: async (patch, current) => {
      const items = await rpc<PaymentNotice[]>('wallet_getPaymentNotices', { accountId });
      if (current()) patch({ items });
    },
  });
  useStorageWatch([{ area: 'local', keys: [paymentRecordsKey(accountId)] }], refresh);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const notice = data.items[0];
  const acknowledge = async () => {
    if (busy || !notice) return;
    setBusy(true);
    setError('');
    try {
      await rpc('wallet_acknowledgePaymentNotices', { accountId, ids: [notice.id] });
      await refresh();
    } catch { setError(t('common.error')); }
    finally { setBusy(false); }
  };
  if (!notice) return null;
  return <Modal title={t('wallet.paymentSent')} maxWidth={340}
    onClose={() => { void acknowledge(); }} dismissOnBackdrop={false}
    footer={<Button disabled={busy} onClick={acknowledge}>{t('common.close')}</Button>}>
    <PaymentReceipt notice={notice} />
    <FormError>{error}</FormError>
  </Modal>;
}
