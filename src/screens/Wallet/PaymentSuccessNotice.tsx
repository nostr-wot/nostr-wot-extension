import { useEffect, useRef, useState } from 'react';
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

export function PaymentReceipt({ notice }: { notice: PaymentNotice }) {
  return <Container gap={4} className="text-center" role="status">
    <div className="text-[48px] leading-none text-success" aria-hidden="true">✓</div>
    <Text className="text-lg font-semibold text-success">{t('wallet.paymentSent')}</Text>
    {notice.amount > 0 && <div className="text-2xl text-success">{formatSats(notice.amount)}</div>}
    <Text className="break-all">{notice.origin}</Text>
    <Text variant="hint">{new Date(notice.timestamp).toLocaleString()}</Text>
  </Container>;
}

/** How long a payment receipt stays on screen. */
export const PAYMENT_NOTICE_MS = 3000;

/**
 * Mounted only for the unlocked account. Receipts survive a closed popup until
 * they have been shown once: each is acknowledged as it appears, so closing the
 * popup clears it too, and it hides itself after three seconds.
 */
export default function PaymentSuccessNotice({ accountId }: { accountId: string }) {
  const { data, refresh } = useAsyncResource<{ items: PaymentNotice[] }>({ items: [] }, {
    load: async (patch, current) => {
      const items = await rpc<PaymentNotice[]>('wallet_getPaymentNotices', { accountId });
      if (current()) patch({ items });
    },
  });
  useStorageWatch([{ area: 'local', keys: [paymentRecordsKey(accountId)] }], refresh);
  const [shown, setShown] = useState<PaymentNotice | null>(null);
  const seen = useRef(new Set<string>());
  const next = data.items.find(item => !seen.current.has(item.id));
  useEffect(() => {
    if (shown || !next) return;
    seen.current.add(next.id);
    setShown(next);
    // A failed acknowledgement only means the receipt shows again next time.
    void rpc('wallet_acknowledgePaymentNotices', { accountId, ids: [next.id] }).catch(() => {});
  }, [shown, next, accountId]);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(null), PAYMENT_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  if (!shown) return null;
  return <Modal title={t('wallet.paymentSent')} maxWidth={340} onClose={() => setShown(null)}
    footer={<Button onClick={() => setShown(null)}>{t('common.close')}</Button>}>
    <PaymentReceipt notice={shown} />
  </Modal>;
}
